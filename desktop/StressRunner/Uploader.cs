using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace StressRunner;

/// <summary>Отправка результатов на сайт (backend-функция stress, action=ingest).</summary>
public class Uploader
{
    private readonly AppSettings _settings;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(5) };

    public Uploader(AppSettings settings)
    {
        _settings = settings;
    }

    /// <summary>Шлёт готовый JSON прогона. Возвращает true при успехе.</summary>
    public async Task<bool> SendAsync(string payloadJson)
    {
        try
        {
            var url = _settings.IngestUrl;
            url += (url.Contains('?') ? "&" : "?") + "action=ingest";

            using var req = new HttpRequestMessage(HttpMethod.Post, url);
            req.Headers.Add("X-Stress-Token", _settings.Token);
            req.Content = new StringContent(payloadJson, Encoding.UTF8, "application/json");

            using var resp = await Http.SendAsync(req);
            string text = await resp.Content.ReadAsStringAsync();

            if (resp.IsSuccessStatusCode)
            {
                Console.WriteLine($"    Отправлено на сайт: {text}");
                return true;
            }
            Console.WriteLine($"    Сайт ответил {(int)resp.StatusCode}: {text}");
            return false;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"    Ошибка отправки: {ex.Message}");
            return false;
        }
    }

    public static string Serialize(RunPayload run) =>
        JsonSerializer.Serialize(run, new JsonSerializerOptions { WriteIndented = false });
}
