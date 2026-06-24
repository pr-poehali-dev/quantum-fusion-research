using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;

namespace StressRunner;

/// <summary>
/// Сетевая диагностика подключения к сайту. Пошагово проверяет: есть ли сеть,
/// резолвится ли DNS, открывается ли TCP:443, отвечает ли HTTPS, и проходит ли
/// реальный запрос verify_token. Пишет понятный отчёт — чтобы понять, на каком
/// этапе рвётся (гео-блокировка, DNS, файрвол, прокси и т.п.).
/// </summary>
public static class NetDiag
{
    public class Result
    {
        public readonly StringBuilder Log = new();
        public bool Ok;
        public void Line(string s) => Log.AppendLine(s);
    }

    // С DoH-обходом блокировки DNS и системным прокси.
    private static readonly HttpClient Http = HttpFactory.Create(TimeSpan.FromSeconds(15));

    public static async Task<Result> RunAsync(AppSettings settings)
    {
        var r = new Result();
        r.Line("=== Диагностика сети StressRunner ===");
        r.Line($"Время: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
        r.Line("");

        // 0) Базовое наличие сети
        bool netUp = NetworkInterface.GetIsNetworkAvailable();
        r.Line($"[0] Сеть доступна (адаптер): {(netUp ? "ДА" : "НЕТ")}");

        // URL и хост
        string url = settings.IngestUrl;
        string host;
        try { host = new Uri(url).Host; }
        catch { r.Line($"[!] Некорректный ingest_url: {url}"); return r; }
        r.Line($"    URL: {url}");
        r.Line($"    Хост: {host}");
        r.Line("");

        // 1) Системный DNS
        IPAddress[]? ips = null;
        try
        {
            var sw = Stopwatch.StartNew();
            ips = await Dns.GetHostAddressesAsync(host);
            sw.Stop();
            r.Line($"[1] Системный DNS: OK за {sw.ElapsedMilliseconds} мс → {string.Join(", ", (object[])ips)}");
        }
        catch (Exception ex)
        {
            r.Line($"[1] Системный DNS: ОШИБКА — {ex.Message} (вероятно блокировка провайдера)");
        }

        // 1b) DNS-over-HTTPS (обход блокировки)
        if (ips == null || ips.Length == 0)
        {
            var sw = Stopwatch.StartNew();
            ips = await DohResolver.ResolveAsync(host);
            sw.Stop();
            if (ips != null && ips.Length > 0)
                r.Line($"[1b] DNS-over-HTTPS: OK за {sw.ElapsedMilliseconds} мс → {string.Join(", ", (object[])ips)}");
            else
            {
                r.Line($"[1b] DNS-over-HTTPS: НЕ СРАБОТАЛ за {sw.ElapsedMilliseconds} мс");
                r.Line("    Даже обход DNS не помог — режут и Cloudflare/Google DNS, или нет интернета.");
                return r;
            }
        }

        // 2) TCP :443 (по первому IP — системному или из DoH)
        try
        {
            var sw = Stopwatch.StartNew();
            using var tcp = new TcpClient();
            var connect = tcp.ConnectAsync(ips[0], 443);
            var done = await Task.WhenAny(connect, Task.Delay(8000));
            sw.Stop();
            if (done != connect || !tcp.Connected)
            {
                r.Line($"[2] TCP 443: НЕ ОТКРЫЛСЯ (таймаут {sw.ElapsedMilliseconds} мс)");
                r.Line("    Порт 443 закрыт/режется (файрвол, провайдер, гео-блокировка по IP).");
                return r;
            }
            r.Line($"[2] TCP 443: OK за {sw.ElapsedMilliseconds} мс");
        }
        catch (Exception ex)
        {
            r.Line($"[2] TCP 443: ОШИБКА — {ex.Message}");
            return r;
        }

        // 3) HTTPS GET (любой ответ = TLS работает)
        try
        {
            var sw = Stopwatch.StartNew();
            using var resp = await Http.GetAsync(url);
            sw.Stop();
            r.Line($"[3] HTTPS: ответ {(int)resp.StatusCode} за {sw.ElapsedMilliseconds} мс");
        }
        catch (TaskCanceledException)
        {
            r.Line("[3] HTTPS: ТАЙМАУТ (>15 сек). Соединение есть, но ответа нет — режут трафик/медленно.");
            return r;
        }
        catch (HttpRequestException ex)
        {
            r.Line($"[3] HTTPS: ОШИБКА — {ex.Message}");
            if (ex.InnerException != null) r.Line($"    Внутр.: {ex.InnerException.Message}");
            r.Line("    Возможно TLS/сертификат режется (DPI, гео-блокировка функций).");
            return r;
        }

        // 4) Реальный запрос verify_token (если токен задан)
        if (!string.IsNullOrWhiteSpace(settings.Token))
        {
            try
            {
                var vurl = url + (url.Contains('?') ? "&" : "?") + "action=verify_token";
                using var req = new HttpRequestMessage(HttpMethod.Get, vurl);
                req.Headers.Add("X-Stress-Token", settings.Token);
                var sw = Stopwatch.StartNew();
                using var resp = await Http.SendAsync(req);
                sw.Stop();
                string body = await resp.Content.ReadAsStringAsync();
                r.Line($"[4] verify_token: {(int)resp.StatusCode} за {sw.ElapsedMilliseconds} мс");
                r.Line($"    Ответ: {Trim(body)}");
                r.Ok = resp.IsSuccessStatusCode;
                r.Line(r.Ok ? "    ✓ Ключ принят — подключение полностью работает." : "    ✗ Ключ не принят (403) — проверь STRESS_INGEST_TOKEN.");
            }
            catch (Exception ex)
            {
                r.Line($"[4] verify_token: ОШИБКА — {ex.Message}");
            }
        }
        else
        {
            r.Line("[4] verify_token: пропущен (ключ не задан). Связь до сайта есть.");
            r.Ok = true;
        }

        r.Line("");
        r.Line(r.Ok ? "ИТОГ: подключение работает." : "ИТОГ: есть проблема — см. шаг с ОШИБКА/ТАЙМАУТ выше.");
        return r;
    }

    private static string Trim(string s) => s.Length > 200 ? s[..200] + "…" : s;
}