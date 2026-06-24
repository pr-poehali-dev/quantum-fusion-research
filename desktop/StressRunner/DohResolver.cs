using System.Net;
using System.Net.Http;
using System.Text.Json;

namespace StressRunner;

/// <summary>
/// Резолвинг доменного имени через DNS-over-HTTPS (DoH) — в обход
/// провайдерского DNS. Нужно там, где DNS блокирует functions.poehali.dev
/// (напр. у некоторых провайдеров). Спрашиваем IP у Cloudflare/Google по HTTPS,
/// IP их серверов (1.1.1.1 / 8.8.8.8) обычно не блокируются.
/// </summary>
public static class DohResolver
{
    // DoH-эндпоинты: обращаемся по IP, чтобы не зависеть от DNS вообще.
    private static readonly string[] Endpoints =
    {
        "https://1.1.1.1/dns-query?type=A&name=",          // Cloudflare
        "https://8.8.8.8/resolve?type=A&name=",            // Google
        "https://cloudflare-dns.com/dns-query?type=A&name=",
    };

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(8) };
    private static readonly Dictionary<string, (IPAddress[] ips, DateTime at)> _cache = new();

    /// <summary>Получить IP-адреса хоста через DoH. null — не удалось.</summary>
    public static async Task<IPAddress[]?> ResolveAsync(string host)
    {
        // Кэш на 5 минут.
        lock (_cache)
        {
            if (_cache.TryGetValue(host, out var c) && (DateTime.UtcNow - c.at).TotalMinutes < 5)
                return c.ips;
        }

        foreach (var ep in Endpoints)
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, ep + Uri.EscapeDataString(host));
                req.Headers.Add("Accept", "application/dns-json");
                using var resp = await Http.SendAsync(req);
                if (!resp.IsSuccessStatusCode) continue;

                string json = await resp.Content.ReadAsStringAsync();
                var ips = ParseAnswers(json);
                if (ips.Length > 0)
                {
                    lock (_cache) { _cache[host] = (ips, DateTime.UtcNow); }
                    return ips;
                }
            }
            catch { /* пробуем следующий эндпоинт */ }
        }
        return null;
    }

    private static IPAddress[] ParseAnswers(string json)
    {
        var list = new List<IPAddress>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("Answer", out var answers))
            {
                foreach (var a in answers.EnumerateArray())
                {
                    // type 1 = A-запись (IPv4)
                    if (a.TryGetProperty("type", out var t) && t.GetInt32() == 1 &&
                        a.TryGetProperty("data", out var d))
                    {
                        if (IPAddress.TryParse(d.GetString(), out var ip))
                            list.Add(ip);
                    }
                }
            }
        }
        catch { }
        return list.ToArray();
    }
}
