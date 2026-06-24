using System.IO;
using System.Text;
using System.Text.Json;

namespace StressRunner;

/// <summary>
/// Консольный (пакетный) режим: StressRunner.exe run "Имя профиля".
/// Запускает профиль без окна — удобно для планировщика задач / автозапуска.
/// GUI-режим живёт в App.xaml / MainWindow.
///
/// Файлы рядом с exe:
///   settings.json   — URL сайта, токен, имя ПК
///   profiles.json   — кэш профилей (тянутся с сайта)
///   stressrunner.db — локальная база результатов
/// </summary>
internal static class ConsoleMode
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Точка входа пакетного режима. args: ["run", "Имя профиля"].</summary>
    public static async Task RunAsync(string[] args)
    {
        try { Console.OutputEncoding = Encoding.UTF8; } catch { }
        Console.WriteLine("===== StressRunner (пакетный режим) =====\n");

        Paths.EnsureDirs();
        var settings = LoadSettings();
        var storage = new Storage(Paths.Db);
        var profiles = await PullOrLoadProfiles(settings);

        string profileName = args.Length >= 2 ? args[1] : (profiles.FirstOrDefault()?.Name ?? "");
        var p = profiles.FirstOrDefault(x => x.Name.Equals(profileName, StringComparison.OrdinalIgnoreCase));
        if (p == null) { Console.WriteLine($"Профиль '{profileName}' не найден."); return; }

        await ExecuteProfile(p, settings, storage);
    }

    private static async Task ExecuteProfile(Profile profile, AppSettings settings, Storage storage)
    {
        var runner = new Runner(settings);
        var run = runner.RunProfile(profile);

        string json = Uploader.Serialize(run);
        storage.SaveRun(run, json);
        Console.WriteLine($"\nПрогон сохранён локально (run_uid={run.RunUid}).");

        int passed = run.Results.Count(r => r.Success);
        Console.WriteLine($"Итог: {passed}/{run.Results.Count} успешно.\n");

        if (!string.IsNullOrWhiteSpace(settings.Token))
        {
            Console.WriteLine("Отправляю на сайт...");
            var up = new Uploader(settings);
            if (await up.SendAsync(json))
                storage.MarkSent(run.RunUid);
            else
                Console.WriteLine("Не доставлено — сохранено локально.");
        }
    }

    private static async Task<List<Profile>> PullOrLoadProfiles(AppSettings settings)
    {
        if (!string.IsNullOrWhiteSpace(settings.Token))
        {
            var up = new Uploader(settings);
            var pulled = await up.PullProfilesAsync();
            if (pulled != null && pulled.Count > 0)
            {
                try { File.WriteAllText(Paths.Profiles, JsonSerializer.Serialize(pulled, JsonOpts)); } catch { }
                Console.WriteLine($"Загружено профилей с сайта: {pulled.Count}");
                return pulled;
            }
        }
        return LoadProfiles();
    }

    // ─── Загрузка/создание конфигов ───────────────────────────────────────

    private static AppSettings LoadSettings()
    {
        if (!File.Exists(Paths.Settings))
        {
            var def = new AppSettings();
            File.WriteAllText(Paths.Settings, JsonSerializer.Serialize(def, JsonOpts));
            Console.WriteLine($"Создан {Paths.Settings} — впиши токен.\n");
            return def;
        }
        return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(Paths.Settings)) ?? new AppSettings();
    }

    private static List<Profile> LoadProfiles()
    {
        if (!File.Exists(Paths.Profiles)) return new List<Profile>();
        return JsonSerializer.Deserialize<List<Profile>>(File.ReadAllText(Paths.Profiles)) ?? new List<Profile>();
    }
}