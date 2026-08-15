"""Отправка уведомлений о стресс-тестах в Telegram.

Берёт TELEGRAM_BOT_TOKEN и STRESS_TG_CHAT_ID из окружения.
Никогда не роняет основной поток: при ошибке логирует и возвращает статус.
"""
import os
import socket
import ssl
import threading
import http.client
import time
import json
import urllib.request
import urllib.parse
import urllib.error



# Таймауты подключения к Telegram: 1 сек не хватало на TLS-рукопожатие
# в облаке — все попытки срывались на connect, уведомления не уходили.
TG_CONNECT_TIMEOUT = 5.0
TG_READ_TIMEOUT = 10.0

# У api.telegram.org несколько дата-центров, и из облака провайдера часть из них
# недоступна: DNS стабильно отдаёт 149.154.166.110, но TCP до него не проходит
# (timeout), тогда как 149.154.167.220 отвечает за ~50 мс.
#
# ВАЖНО (v8.08): последовательный перебор адресов не годится. Лимит исполнения
# функции бывает 5 сек (stress), и одно ожидание мёртвого адреса съедало его
# целиком — уведомление не успевало уйти, вызов падал с 504.
# Поэтому подключаемся ко ВСЕМ адресам ПАРАЛЛЕЛЬНО и берём первый ответивший
# (happy eyeballs). Мёртвые адреса больше не задерживают отправку.
TG_HOST = "api.telegram.org"
TG_FALLBACK_IPS = [
    "149.154.167.220",
    "149.154.175.50",
    "149.154.166.110",
    "91.108.56.130",
    "149.154.171.5",
]
# Бюджет на установку связи — заведомо меньше самого жёсткого лимита функции
# (5 сек), чтобы осталось время на сам запрос и ответ.
TG_DIAL_TIMEOUT = 2.5

_tg_conn = None
_tg_ip_ok = None  # последний IP, с которым связь реально поднялась


def _tg_candidate_ips():
    ips = []
    if _tg_ip_ok:
        ips.append(_tg_ip_ok)
    for ip in TG_FALLBACK_IPS:
        if ip not in ips:
            ips.append(ip)
    try:
        for i in socket.getaddrinfo(TG_HOST, 443, socket.AF_INET, socket.SOCK_STREAM):
            ip = i[4][0]
            if ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips


def _tg_open():
    """TLS-соединение с Telegram: все адреса пробуются ПАРАЛЛЕЛЬНО,
    берётся первый ответивший — мёртвый DC не тормозит отправку."""
    global _tg_ip_ok
    ctx = ssl.create_default_context()
    result = {}
    lock = threading.Lock()
    done = threading.Event()

    def dial(ip):
        try:
            raw = socket.create_connection((ip, 443), timeout=TG_DIAL_TIMEOUT)
            tls = ctx.wrap_socket(raw, server_hostname=TG_HOST)
        except Exception as e:
            with lock:
                result.setdefault("err", e)
            return
        with lock:
            if "sock" in result:
                try:
                    tls.close()
                except Exception:
                    pass
                return
            result["sock"] = tls
            result["ip"] = ip
        done.set()

    for ip in _tg_candidate_ips():
        threading.Thread(target=dial, args=(ip,), daemon=True).start()
    done.wait(TG_DIAL_TIMEOUT + 0.5)
    with lock:
        sock = result.get("sock")
        ip = result.get("ip")
        err = result.get("err")
    if sock is None:
        raise err if err else RuntimeError("telegram unreachable")
    sock.settimeout(TG_READ_TIMEOUT)
    c = http.client.HTTPSConnection(TG_HOST, 443, timeout=TG_READ_TIMEOUT)
    c.sock = sock
    _tg_ip_ok = ip
    return c


def _tg_post(path: str, data: bytes, headers: dict):
    """POST в Telegram по переиспользуемому соединению.

    Важно про дубли: таймаут ОТВЕТА не означает, что сообщение не дошло —
    Telegram мог принять его и не успеть ответить. Поэтому повторяем только
    то, что заведомо не доставлено:
      * не удалось установить соединение — сообщение точно не ушло;
      * оборвалось переиспользованное соединение (сервер закрыл его по
        таймауту) — запрос до Telegram тоже не дошёл.
    А вот сбой на СВЕЖЕМ соединении уже после отправки не повторяем никогда:
    именно такой ретрай и слал одно и то же сообщение по несколько раз.
    """
    global _tg_conn
    last_err = None
    # Попыток 3, а не 5: с TG_CONNECT_TIMEOUT=5s пять попыток съели бы ~26 сек
    # и функция упала бы по таймауту исполнения.
    for _ in range(3):
        fresh = False
        try:
            if _tg_conn is None:
                _tg_conn = _tg_open()
                fresh = True
        except Exception as e:
            last_err = e
            _tg_conn = None
            time.sleep(0.2)
            continue
        try:
            _tg_conn.request("POST", path, data, headers)
            resp = _tg_conn.getresponse()
            raw = resp.read()
            return resp.status, raw
        except Exception as e:
            last_err = e
            try:
                _tg_conn.close()
            except Exception:
                pass
            _tg_conn = None
            if fresh:
                # Запрос мог дойти до Telegram — повтор создаст дубль
                raise
            time.sleep(0.2)
    raise last_err if last_err else RuntimeError("telegram unreachable")


# ── Маршрутизация событий из админки (вкладка «Telegram-бот») ──────────────
SCHEMA_TG = os.environ.get("MAIN_DB_SCHEMA") or "t_p72635010_quantum_fusion_resea"


def _tg_route(event_key: str):
    """Настройки события: включено ли и в какой чат слать.
    Настроек нет или БД недоступна — работаем как раньше (чат по умолчанию)."""
    if not event_key:
        return True, None
    try:
        import psycopg2
        with psycopg2.connect(os.environ["DATABASE_URL"]) as c:
            with c.cursor() as cur:
                cur.execute(
                    f"SELECT enabled, chat_id FROM {SCHEMA_TG}.tg_event_routes "
                    f"WHERE event_key = '" + event_key.replace("'", "''") + "'")
                row = cur.fetchone()
        if not row:
            return True, None
        return bool(row[0]), (str(row[1]) if row[1] is not None else None)
    except Exception as e:
        print(f"TG_ROUTE: {e}")
        return True, None


def _tg_log(event_key, chat_id, ok, error=None, preview=None):
    """Журнал отправок для админки. Никогда не роняет основной поток."""
    try:
        import psycopg2
        def q(v):
            return "NULL" if v is None else "'" + str(v)[:300].replace("'", "''") + "'"
        cid = str(chat_id or "").strip()
        cid_sql = cid if cid.lstrip("-").isdigit() else "NULL"
        with psycopg2.connect(os.environ["DATABASE_URL"]) as c:
            with c.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {SCHEMA_TG}.tg_send_log "
                    f"(event_key, chat_id, status, error, preview) VALUES "
                    f"({q(event_key)}, {cid_sql}, '{'ok' if ok else 'error'}', "
                    f"{q(error)}, {q(preview)})")
            c.commit()
    except Exception as e:
        print(f"TG_LOG: {e}")


def send_stress(text: str, chat_id: str = None) -> dict:
    """Шлёт сообщение в Telegram. Возвращает {ok, error?} с реальным статусом.

    chat_id=None — общий админский чат из STRESS_TG_CHAT_ID (прежнее поведение).
    chat_id задан — шлём в этот чат (чаты партнёров из stress_notify_chats).

    Логирует ответ Telegram (в т.ч. description ошибки) для диагностики.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if chat_id is None:
        chat_id = os.environ.get("STRESS_TG_CHAT_ID")
    chat_id = str(chat_id or "").strip()
    if not token or not chat_id:
        print("STRESS_TG: пропуск — нет TELEGRAM_BOT_TOKEN / chat_id")
        return {"ok": False, "error": "no_token_or_chat"}
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
    enabled, route_chat = _tg_route("stress_result")
    if not enabled:
        print("STRESS_TG: событие stress_result выключено в админке")
        return {"ok": False, "error": "disabled"}
    if route_chat:
        chat_id = route_chat
        data = urllib.parse.urlencode({
            "chat_id": chat_id, "text": text, "parse_mode": "HTML",
            "disable_web_page_preview": "true",
        }).encode()
    last_err = None
    try:
        status, raw = _tg_post(
            url.split("api.telegram.org", 1)[1], data,
            {"Content-Type": "application/x-www-form-urlencoded"})
        body = raw.decode("utf-8", "replace")
        payload = json.loads(body) if body else {}
        if payload.get("ok"):
            _tg_log("stress_result", chat_id, True, None, text)
            return {"ok": True}
        desc = payload.get("description") or body
        print(f"STRESS_TG: Telegram отклонил chat_id={chat_id} — {desc}")
        _tg_log("stress_result", chat_id, False, desc, text)
        return {"ok": False, "error": desc if status == 200 else f"http_{status}: {desc}"}
    except Exception as e:
        last_err = str(e)
        print(f"STRESS_TG: сетевая ошибка chat_id={chat_id} — {e}")
    return {"ok": False, "error": str(last_err)}


def notify_stress(text: str) -> bool:
    """Совместимость: True/False."""
    return bool(send_stress(text).get("ok"))