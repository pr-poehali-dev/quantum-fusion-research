"""Telegram-уведомления партнёров о стресс-тестах.

Модель настроек двухуровневая:
  • stress_notify_settings — общие настройки компании (события + шаблоны);
  • stress_notify_chats    — чаты партнёра. Флаги события в чате могут быть
    NULL (наследовать компанию) либо TRUE/FALSE (переопределить). Шаблон чата
    пустой = взять шаблон компании.

Уведомления партнёра идут ТОЛЬКО по прогонам его компании и никак не влияют
на общий админский чат (STRESS_TG_CHAT_ID), который работает как раньше.
"""
import os
import re
import hashlib
import html as html_mod

from tg_notify import send_stress, edit_stress

SCHEMA = "t_p72635010_quantum_fusion_resea"

EVENTS = ("run_started", "test_failed", "run_finished")

# События новой программы сводим к трём, по которым партнёр настраивает
# рассылку (спека NOTIFY_TELEGRAM_FORMAT.md).
EVENT_ALIASES = {
    "test_stand_started": "run_started",
    "gpu_maintenance_required": "run_finished",
    "upload_failed": "run_finished",
    "run_interrupted": "run_finished",
    "heartbeat_stale": "test_failed",
}

# Стандартные шаблоны (используются, если партнёр не задал свой).
DEFAULT_TPL = {
    "run_started": (
        "{заголовок}\n"
        "\n"
        "🖥 Стенд: <b>{пк}</b>{заказ}\n"
        "📋 Профиль: {профиль}{тесты}{примечание}{хвост}{ссылка}"
    ),
    "test_failed": (
        "{заголовок}\n"
        "\n"
        "🖥 Стенд: <b>{пк}</b>{заказ}\n"
        "📋 Профиль: {профиль}{тесты}{примечание}{хвост}{ссылка}"
    ),
    "run_finished": (
        "{заголовок}\n"
        "\n"
        "🖥 Стенд: <b>{пк}</b>{заказ}\n"
        "📋 Профиль: {профиль}{тесты}{примечание}{хвост}{ссылка}"
    ),
}

# Подстановки, доступные партнёру в шаблоне (показываем их же в интерфейсе).
PLACEHOLDERS = ["{заголовок}", "{пк}", "{заказ}", "{профиль}", "{тесты}",
                "{примечание}", "{хвост}", "{тест}", "{код}", "{длительность}",
                "{успешно}", "{всего}", "{ошибок}", "{статус}", "{ссылка}"]


def _esc(v) -> str:
    return html_mod.escape("—" if v is None or v == "" else str(v), quote=False)


def _site_base() -> str:
    site = os.environ.get("SITE_BASE_URL", "").rstrip("/")
    if not site or "poehali.dev" in site:
        site = "https://begraphics.ru"
    return site


def _site_link(public_code: str = "") -> str:
    """Ссылка в конце сообщения.

    Если известен публичный код отчёта — даём прямую ссылку на сам отчёт:
    её можно сразу переслать клиенту. Иначе — вход в кабинет, как раньше.
    """
    code = str(public_code or "").strip()
    if code:
        return f"\n\n🔗 Отчёт: {_site_base()}/tests/{code}"
    return f"\n\n🔗 {_site_base()}/partners/stresstester"


def default_settings() -> dict:
    """Настройки компании по умолчанию (когда строки в БД ещё нет)."""
    return {
        "enabled": True,
        "on_run_started": False,
        "on_test_failed": True,
        "on_run_finished": True,
        "only_failures": False,
        "tpl_run_started": "",
        "tpl_test_failed": "",
        "tpl_run_finished": "",
    }


def get_settings(cur, company_id):
    """Настройки компании; если строки нет — значения по умолчанию."""
    if not company_id:
        return default_settings()
    cur.execute(
        f"SELECT enabled, on_run_started, on_test_failed, on_run_finished, "
        f"only_failures, tpl_run_started, tpl_test_failed, tpl_run_finished "
        f"FROM {SCHEMA}.stress_notify_settings WHERE company_id = %s",
        (int(company_id),),
    )
    r = cur.fetchone()
    if not r:
        return default_settings()
    return {
        "enabled": bool(r[0]), "on_run_started": bool(r[1]),
        "on_test_failed": bool(r[2]), "on_run_finished": bool(r[3]),
        "only_failures": bool(r[4]),
        "tpl_run_started": r[5] or "", "tpl_test_failed": r[6] or "",
        "tpl_run_finished": r[7] or "",
    }


def save_settings(cur, company_id, body):
    """UPSERT настроек компании."""
    s = default_settings()
    s.update({k: body[k] for k in s.keys() if k in body})
    cur.execute(
        f"INSERT INTO {SCHEMA}.stress_notify_settings "
        f"(company_id, enabled, on_run_started, on_test_failed, on_run_finished, "
        f"only_failures, tpl_run_started, tpl_test_failed, tpl_run_finished) "
        f"VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
        f"ON CONFLICT (company_id) DO UPDATE SET "
        f"enabled=EXCLUDED.enabled, on_run_started=EXCLUDED.on_run_started, "
        f"on_test_failed=EXCLUDED.on_test_failed, on_run_finished=EXCLUDED.on_run_finished, "
        f"only_failures=EXCLUDED.only_failures, tpl_run_started=EXCLUDED.tpl_run_started, "
        f"tpl_test_failed=EXCLUDED.tpl_test_failed, tpl_run_finished=EXCLUDED.tpl_run_finished, "
        f"updated_at=NOW()",
        (int(company_id), bool(s["enabled"]), bool(s["on_run_started"]),
         bool(s["on_test_failed"]), bool(s["on_run_finished"]),
         bool(s["only_failures"]), str(s["tpl_run_started"] or "")[:4000],
         str(s["tpl_test_failed"] or "")[:4000], str(s["tpl_run_finished"] or "")[:4000]),
    )
    return get_settings(cur, company_id)


def list_chats(cur, company_id):
    cur.execute(
        f"SELECT id, chat_id, title, enabled, on_run_started, on_test_failed, "
        f"on_run_finished, only_failures, tpl_run_started, tpl_test_failed, "
        f"tpl_run_finished, last_ok_at, last_error "
        f"FROM {SCHEMA}.stress_notify_chats WHERE company_id = %s ORDER BY id",
        (int(company_id),),
    )
    out = []
    for r in cur.fetchall():
        out.append({
            "id": r[0], "chat_id": r[1], "title": r[2], "enabled": bool(r[3]),
            "on_run_started": r[4], "on_test_failed": r[5],
            "on_run_finished": r[6], "only_failures": r[7],
            "tpl_run_started": r[8] or "", "tpl_test_failed": r[9] or "",
            "tpl_run_finished": r[10] or "",
            "last_ok_at": r[11].isoformat() if r[11] else None,
            "last_error": r[12] or "",
        })
    return out


def save_chat(cur, company_id, body):
    """Добавить или обновить чат. Возвращает (ok, error|None).

    chat_id уникален глобально: если он уже привязан к другой компании —
    отказываем, чтобы чужие прогоны не ушли в посторонний чат.
    """
    chat_id = str(body.get("chat_id") or "").strip()
    rec_id = body.get("id")
    if not rec_id and not chat_id:
        return None, "empty_chat_id"
    if chat_id:
        cur.execute(
            f"SELECT id, company_id FROM {SCHEMA}.stress_notify_chats WHERE chat_id = %s",
            (chat_id,),
        )
        ex = cur.fetchone()
        if ex and int(ex[1]) != int(company_id):
            return None, "chat_taken"
        if ex and not rec_id:
            rec_id = ex[0]

    title = str(body.get("title") or "")[:128]
    tri = lambda k: (None if body.get(k) is None else bool(body.get(k)))

    if rec_id:
        cur.execute(
            f"UPDATE {SCHEMA}.stress_notify_chats SET "
            f"chat_id=COALESCE(NULLIF(%s,''), chat_id), title=%s, enabled=%s, "
            f"on_run_started=%s, on_test_failed=%s, on_run_finished=%s, only_failures=%s, "
            f"tpl_run_started=%s, tpl_test_failed=%s, tpl_run_finished=%s, updated_at=NOW() "
            f"WHERE id=%s AND company_id=%s",
            (chat_id, title, bool(body.get("enabled", True)),
             tri("on_run_started"), tri("on_test_failed"), tri("on_run_finished"),
             tri("only_failures"), str(body.get("tpl_run_started") or "")[:4000],
             str(body.get("tpl_test_failed") or "")[:4000],
             str(body.get("tpl_run_finished") or "")[:4000],
             int(rec_id), int(company_id)),
        )
        return int(rec_id), None

    cur.execute(
        f"INSERT INTO {SCHEMA}.stress_notify_chats "
        f"(company_id, chat_id, title, enabled, on_run_started, on_test_failed, "
        f"on_run_finished, only_failures, tpl_run_started, tpl_test_failed, tpl_run_finished) "
        f"VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (int(company_id), chat_id, title, bool(body.get("enabled", True)),
         tri("on_run_started"), tri("on_test_failed"), tri("on_run_finished"),
         tri("only_failures"), str(body.get("tpl_run_started") or "")[:4000],
         str(body.get("tpl_test_failed") or "")[:4000],
         str(body.get("tpl_run_finished") or "")[:4000]),
    )
    return int(cur.fetchone()[0]), None


def delete_chat(cur, company_id, rec_id):
    cur.execute(
        f"DELETE FROM {SCHEMA}.stress_notify_chats WHERE id=%s AND company_id=%s",
        (int(rec_id), int(company_id)),
    )
    return True


TEST_STATUS_EMOJI = {
    "ok": "✅", "error": "💥", "problem": "💥", "crash": "💥",
    "warning": "⚠️", "skipped": "⏭", "pending": "⏳", "running": "▶️",
}


def _tests_block(tests):
    """Список тестов профиля со смайлами статусов."""
    tests = tests or []
    if not tests:
        return ""
    lines = ["", "", "Тесты:"]
    for t in tests:
        emoji = TEST_STATUS_EMOJI.get(str(t.get("status") or "").lower(), "•")
        line = f"{emoji} {_esc(t.get('name'))}"
        detail = (t.get("detail") or "").strip() if t.get("detail") else ""
        if detail:
            line += f" — {_esc(detail)}"
        lines.append(line)
    return "\n".join(lines)


def _vars_for(event, data):
    """Значения подстановок шаблона (все экранированы под parse_mode=HTML)."""
    total = int(data.get("total") or 0)
    passed = int(data.get("passed") or 0)
    failed = data.get("failed")
    failed = int(failed) if failed is not None else max(total - passed, 0)
    dur = data.get("duration_sec")

    order = (data.get("order_number") or "").strip() if data.get("order_number") else ""
    note = (data.get("note") or "").strip() if data.get("note") else ""
    headline = (data.get("headline") or "").strip()
    if not headline:
        headline = {
            "run_started": "▶️ Прогон запущен",
            "test_failed": f"💥 Упал тест: {data.get('test_name') or '—'}",
        }.get(event, "✅ Прогон завершён — всё в порядке" if failed == 0
              else "⚠️ Прогон завершён с ошибками")

    return {
        "заголовок": f"<b>{_esc(headline)}</b>",
        "пк": _esc(data.get("machine")),
        "заказ": f"\n📦 Заказ: {_esc(order)}" if order else "",
        "профиль": _esc(data.get("profile")),
        "тесты": _tests_block(data.get("tests")),
        "примечание": f"\n\n📝 {_esc(note)}" if note else "",
        "хвост": data.get("tail") or "",
        "тест": _esc(data.get("test_name")),
        "код": "—" if data.get("exit_code") is None else _esc(data.get("exit_code")),
        "длительность": f"{float(dur):.0f} сек" if dur is not None else "—",
        "успешно": str(passed),
        "всего": str(total),
        "ошибок": str(failed),
        "статус": "✅" if failed == 0 else "⚠️",
        "ссылка": _site_link(data.get("public_code")),
        "отчёт": _site_link(data.get("public_code")),
    }


def render(event, template, data):
    """Подставляет значения в шаблон. Неизвестные {плейсхолдеры} не ломают
    отправку — остаются как есть (партнёр сразу увидит опечатку в тексте)."""
    tpl = (template or "").strip() or DEFAULT_TPL.get(event, "")
    if not tpl:
        return None
    out = tpl
    for key, val in _vars_for(event, data).items():
        out = out.replace("{" + key + "}", str(val))
    return out


def _want(chat_val, company_val):
    """Флаг чата: NULL → берём значение компании."""
    return bool(company_val) if chat_val is None else bool(chat_val)


DEDUP_WINDOW_MIN = 5
# Окно объединения событий одного прогона в одно сообщение. Больше, чем окно
# дедупликации: между алертом о перегреве и итогом бывает несколько минут.
MERGE_WINDOW_MIN = 60


def dedup_key(event, data):
    """Ключ события для защиты от дублей.

    ГЛАВНОЕ — run_uid. Десктоп шлёт итог двумя путями (ingest и notify), и в
    них по-разному подписан стенд: в одном «приёмка-левый-стенд», в другом
    «Заказ 5167». Раньше ключ считался по имени стенда — тексты не совпадали,
    дедуп не срабатывал, и партнёр получал два одинаковых сообщения. run_uid
    у обоих путей один и тот же, поэтому теперь он и есть ключ.

    Если run_uid не пришёл (старая версия программы) — падаем на прежний
    расчёт по сути события.
    """
    run_uid = str(data.get("run_uid") or "").strip()
    if run_uid:
        parts = [str(event), run_uid, str(data.get("test_name") or "")]
        if event == "test_failed":
            parts.append(str(data.get("exit_code")))
        return "|".join(parts)[:300]
    total = int(data.get("total") or 0)
    passed = int(data.get("passed") or 0)
    parts = [str(event), str(data.get("machine") or ""),
             str(data.get("profile") or ""), str(data.get("test_name") or "")]
    if event == "run_finished":
        parts.append(f"{passed}/{total}")
    if event == "test_failed":
        parts.append(str(data.get("exit_code")))
    return "|".join(parts)[:300]


# «Вес» финального сообщения о прогоне. Программа шлёт по одному прогону
# несколько событий подряд (алерт → итог), и КАЖДОЕ следующее содержит всё,
# что было в предыдущем. Поэтому в чат отправляется одно сообщение, которое
# дополняется: событие с большим весом переписывает уже отправленное.
FINAL_RANK = {
    # Промежуточные: прогон ещё идёт, сообщение будет дополняться дальше.
    "test_failed": 1,
    "heartbeat_stale": 1,
    # Финальные алерты — прогон закончился нештатно.
    "gpu_maintenance_required": 2,
    "run_interrupted": 2,
    "upload_failed": 2,
    # Итог — самое полное сообщение, перекрывает всё выше.
    "run_finished": 3,
}

# События «прогон в процессе»: могут прийти НЕСКОЛЬКО раз за прогон (упал
# второй тест, третий...). Каждое следующее полнее предыдущего, поэтому при
# равном весе не молчим, а обновляем уже отправленное сообщение.
PROGRESS_EVENTS = {"test_failed", "heartbeat_stale"}


def _slot_keys(data):
    """Все идентификаторы, по которым события ОДНОГО прогона можно связать.

    Программа шлёт события разными путями и не в каждом есть run_uid: в алерте
    о перегреве GPU его нет, зато есть номер заказа и имя стенда. Поэтому слот
    ищем по нескольким ключам сразу — совпал любой, значит это тот же прогон.
    Ключи специально «широкие»: заказ уникален для прогона, имя стенда —
    рабочая подстраховка внутри окна склейки.
    """
    keys = []
    run_uid = str(data.get("run_uid") or "").strip()
    order = str(data.get("order_number") or "").strip()
    machine = str(data.get("machine") or "").strip()
    # Один и тот же стенд приходит то как «стенд Даня», то как
    # «Заказ 5206 · стенд Даня» — приводим к общему виду, иначе события
    # одного прогона попадут в разные слоты и придут двумя сообщениями.
    m = re.match(r"^\s*(?:заказ|order)\s*[№#]?\s*([\w-]+)\s*(?:·|\||-|—|:)\s*(.+)$",
                 machine, re.IGNORECASE)
    if m:
        order = order or m.group(1)
        machine = m.group(2).strip()
    if run_uid:
        keys.append(f"uid|{run_uid}")
    if order:
        keys.append(f"order|{order}")
    if machine:
        keys.append(f"stand|{machine.lower()}")
    return keys


def _h(key):
    return hashlib.sha256(str(key).encode("utf-8")).hexdigest()


def _find_slot(cur, chat_id, keys):
    """Найти живой слот сообщения по любому из ключей."""
    if not keys:
        return None
    hs = [_h(k) for k in keys]
    ph = ",".join(["%s"] * len(hs))
    cur.execute(
        f"SELECT slot_uid, message_id, rank FROM {SCHEMA}.stress_notify_merge "
        f"WHERE chat_id=%s AND slot_key IN ({ph}) "
        f"AND sent_at > NOW() - INTERVAL '{MERGE_WINDOW_MIN} minutes' "
        f"ORDER BY rank DESC, sent_at DESC LIMIT 1",
        tuple([str(chat_id)] + hs))
    return cur.fetchone()


def _claim_merged(cur, chat_id, raw_event, data):
    """Занять слот финального сообщения прогона.

    Возвращает (действие, message_id, slot_uid):
      ("send", None, uid)   — сообщения ещё не было, шлём обычным;
      ("edit", 123, uid)    — сообщение уже есть, ДОПОЛНЯЕМ его новым текстом;
      ("skip", None, None)  — уже отправлено что-то не менее полное, молчим.
    """
    rank = FINAL_RANK.get(raw_event, 0)
    keys = _slot_keys(data)
    if not rank or not keys:
        return "send", None, None
    try:
        cur.execute(
            f"DELETE FROM {SCHEMA}.stress_notify_merge "
            f"WHERE sent_at < NOW() - INTERVAL '{MERGE_WINDOW_MIN} minutes'")
        row = _find_slot(cur, chat_id, keys)
        if row is None:
            slot_uid = _h("|".join(keys))[:32]
            cur.connection.commit()
            return "send", None, slot_uid
        slot_uid, message_id, prev_rank = row[0], row[1], int(row[2] or 0)
        cur.connection.commit()
        # Строго меньше — назад не откатываемся (итог не затирается алертом).
        if rank < prev_rank:
            return "skip", None, None
        # Тот же вес: для «прогон продолжается» это следующий упавший тест —
        # дополняем сообщение. Для остальных — точный повтор, молчим.
        if rank == prev_rank and raw_event not in PROGRESS_EVENTS:
            return "skip", None, None
        if not message_id:
            # Первое сообщение ещё не долетело — шлём обычным, слот тот же.
            return "send", None, slot_uid
        return "edit", message_id, slot_uid
    except Exception as e:
        try:
            cur.connection.rollback()
        except Exception:
            pass
        print(f"STRESS_NOTIFY: объединение недоступно ({e}) — шлём как есть")
        return "send", None, None


def _remember_message(cur, chat_id, slot_uid, raw_event, message_id, data):
    """Запомнить сообщение под ВСЕМИ ключами прогона.

    Ключей несколько, потому что следующее событие может прийти без run_uid —
    тогда слот найдётся по номеру заказа или имени стенда.
    """
    rank = FINAL_RANK.get(raw_event, 0)
    keys = _slot_keys(data)
    if not rank or not keys or not slot_uid:
        return
    mid = int(message_id) if message_id else None
    try:
        for k in keys:
            cur.execute(
                f"INSERT INTO {SCHEMA}.stress_notify_merge "
                f"(chat_id, slot_key, slot_uid, message_id, rank, event) "
                f"VALUES (%s, %s, %s, %s, %s, %s) "
                f"ON CONFLICT (chat_id, slot_key) DO UPDATE SET "
                f"slot_uid=EXCLUDED.slot_uid, message_id=EXCLUDED.message_id, "
                f"rank=EXCLUDED.rank, event=EXCLUDED.event, sent_at=NOW()",
                (str(chat_id), _h(k), slot_uid, mid, rank, str(raw_event)[:40]))
        # Все алиасы этого же слота тоже подтягиваем к новому состоянию.
        cur.execute(
            f"UPDATE {SCHEMA}.stress_notify_merge SET message_id=%s, rank=%s, "
            f"event=%s, sent_at=NOW() WHERE chat_id=%s AND slot_uid=%s",
            (mid, rank, str(raw_event)[:40], str(chat_id), slot_uid))
        cur.connection.commit()
    except Exception as e:
        try:
            cur.connection.rollback()
        except Exception:
            pass
        print(f"STRESS_NOTIFY: не удалось запомнить message_id: {e}")


def _claim_send(cur, chat_id, event, key):
    """Занять право на отправку события (защита от дублей).

    Если такое же событие в этот чат уже уходило за последние
    DEDUP_WINDOW_MIN минут — повтор не отправляем. Через окно повтор снова
    разрешён (это уже новый прогон).
    """
    h = hashlib.sha256(key.encode("utf-8")).hexdigest()
    try:
        cur.execute(
            f"DELETE FROM {SCHEMA}.stress_notify_sent "
            f"WHERE chat_id=%s AND dedup_hash=%s "
            f"AND sent_at < NOW() - INTERVAL '{DEDUP_WINDOW_MIN} minutes'",
            (str(chat_id), h))
        cur.execute(
            f"INSERT INTO {SCHEMA}.stress_notify_sent (chat_id, dedup_hash, event) "
            f"VALUES (%s, %s, %s) ON CONFLICT (chat_id, dedup_hash) DO NOTHING "
            f"RETURNING id", (str(chat_id), h, str(event)[:40]))
        claimed = cur.fetchone() is not None
        # КРИТИЧНО: фиксируем метку сразу. Второй запрос (ingest и notify —
        # это разные вызовы функции, каждый со своим соединением) приходит
        # через секунду; без немедленного commit он не увидит метку и пришлёт
        # сообщение повторно.
        try:
            cur.connection.commit()
        except Exception:
            pass
        return claimed
    except Exception as e:
        try:
            cur.connection.rollback()
        except Exception:
            pass
        print(f"STRESS_NOTIFY: дедупликация недоступна ({e}) — шлём как есть")
        return True


def claim_admin_send(cur, event, data):
    """То же для общего админского чата (у него нет записи в stress_notify_chats)."""
    return _claim_send(cur, "__admin__", event, dedup_key(event, data))


def send_admin_merged(cur, raw_event, data, text):
    """Отправка в общий админский чат с объединением событий прогона.

    Алерт (перегрев / перезагрузка / отчёт не загружен) и следующий за ним
    итог — это одно и то же сообщение на разных стадиях. Второе не шлём,
    а дописываем в первое.
    """
    mode, message_id, slot_uid = _claim_merged(cur, "__admin__", raw_event, data)
    if mode == "skip":
        return {"ok": True, "skipped": "merged"}
    if mode == "edit":
        chat = os.environ.get("STRESS_TG_CHAT_ID")
        res = edit_stress(text, chat, message_id)
        if res.get("ok"):
            _remember_message(cur, "__admin__", slot_uid, raw_event,
                              message_id, data)
            return res
    res = send_stress(text)
    if res.get("ok"):
        _remember_message(cur, "__admin__", slot_uid, raw_event,
                          res.get("message_id"), data)
    return res


def notify_company(cur, company_id, event, data):
    """Разослать событие во все подходящие чаты компании.

    Возвращает {sent, failed, results:[...]}. Никогда не роняет основной поток.
    """
    result = {"sent": 0, "failed": 0, "results": []}
    if not company_id:
        return result
    # Новые события программы раскладываем на три, которыми управляет партнёр.
    raw_event = event
    event = EVENT_ALIASES.get(event, event)
    if event not in EVENTS:
        return result
    try:
        st = get_settings(cur, company_id)
        if not st.get("enabled"):
            return result
        chats = list_chats(cur, company_id)
    except Exception as e:
        print(f"STRESS_NOTIFY: не удалось прочитать настройки company={company_id}: {e}")
        return result

    flag_key = f"on_{event}"
    for ch in chats:
        if not ch.get("enabled"):
            continue
        if not _want(ch.get(flag_key), st.get(flag_key)):
            continue
        # Тихий режим: успешный прогон (без ошибок) не отправляем.
        only_fail = _want(ch.get("only_failures"), st.get("only_failures"))
        if only_fail and event in ("run_finished", "run_started"):
            total = int(data.get("total") or 0)
            passed = int(data.get("passed") or 0)
            failed = data.get("failed")
            failed = int(failed) if failed is not None else max(total - passed, 0)
            if event == "run_started" or failed == 0:
                continue

        tpl_key = f"tpl_{event}"
        tpl = (ch.get(tpl_key) or "").strip() or st.get(tpl_key) or ""
        text = render(event, tpl, data)
        if not text:
            continue
        # Одно и то же событие в один чат за короткое окно — не дублируем.
        if not _claim_send(cur, ch["chat_id"], event, dedup_key(raw_event, data)):
            result["results"].append({"chat_id": ch["chat_id"], "ok": True,
                                      "skipped": "duplicate"})
            continue

        # Финальные события одного прогона (алерт → итог) сводим в ОДНО
        # сообщение: каждое следующее содержит всё из предыдущего, поэтому
        # вместо второго сообщения переписываем первое.
        mode, message_id, slot_uid = _claim_merged(cur, ch["chat_id"], raw_event, data)
        if mode == "skip":
            result["results"].append({"chat_id": ch["chat_id"], "ok": True,
                                      "skipped": "merged"})
            continue
        if mode == "edit":
            res = edit_stress(text, ch["chat_id"], message_id)
            if res.get("ok"):
                _remember_message(cur, ch["chat_id"], slot_uid, raw_event,
                                  message_id, data)
            else:
                # Правка не прошла (сообщение удалили и т.п.) — шлём обычным.
                res = send_stress(text, chat_id=ch["chat_id"])
                if res.get("ok"):
                    _remember_message(cur, ch["chat_id"], slot_uid, raw_event,
                                      res.get("message_id"), data)
        else:
            res = send_stress(text, chat_id=ch["chat_id"])
            if res.get("ok"):
                _remember_message(cur, ch["chat_id"], slot_uid, raw_event,
                                  res.get("message_id"), data)
        try:
            if res.get("ok"):
                cur.execute(
                    f"UPDATE {SCHEMA}.stress_notify_chats "
                    f"SET last_ok_at=NOW(), last_error='' WHERE id=%s", (ch["id"],))
            else:
                cur.execute(
                    f"UPDATE {SCHEMA}.stress_notify_chats "
                    f"SET last_error=%s WHERE id=%s",
                    (str(res.get("error") or "")[:500], ch["id"]))
        except Exception as e:
            print(f"STRESS_NOTIFY: не удалось записать статус чата {ch['id']}: {e}")
        if res.get("ok"):
            result["sent"] += 1
        else:
            result["failed"] += 1
        result["results"].append({"chat_id": ch["chat_id"], "ok": bool(res.get("ok")),
                                  "error": res.get("error")})
    return result


def prefs_for_agent(cur, company_id):
    """Пресет уведомлений для desktop-софта (ответ на verify_token).

    Софт по нему понимает, какие события вообще имеет смысл отправлять.
    """
    st = get_settings(cur, company_id) if company_id else default_settings()
    try:
        chats = list_chats(cur, company_id) if company_id else []
    except Exception:
        chats = []
    active = [c for c in chats if c.get("enabled")]
    # Событие нужно, если его ждёт хотя бы один активный чат.
    want = {}
    for ev in EVENTS:
        k = f"on_{ev}"
        want[ev] = bool(st.get("enabled")) and any(
            _want(c.get(k), st.get(k)) for c in active)
    return {
        "enabled": bool(st.get("enabled")) and bool(active),
        "chats_count": len(active),
        "events": want,
        "only_failures": bool(st.get("only_failures")),
    }