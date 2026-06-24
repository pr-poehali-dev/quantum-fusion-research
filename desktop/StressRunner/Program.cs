using System.Text;
using System.Text.Json;

namespace StressRunner;

/// <summary>
/// StressRunner — консольное приложение для запуска стресс-тестов по списку.
/// Запускает внешние программы/скрипты на заданное время, сохраняет результат
/// в локальную БД (SQLite) и отправляет на сайт.
///
/// Файлы рядом с exe:
///   settings.json  — URL сайта, токен, имя ПК
///   profiles.json  — профили (наборы тестов)
///   stressrunner.db — локальная база результатов
/// </summary>
internal class Program
{
    private static readonly string BaseDir = AppContext.BaseDirectory;
    private static string Path(string name) => System.IO.Path.Combine(BaseDir, name);

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Console.WriteLine("===== StressRunner =====\n");

        var settings = LoadSettings();
        var profiles = LoadProfiles();
        var storage = new Storage(Path("stressrunner.db"));

        if (string.IsNullOrWhiteSpace(settings.Token))
        {
            Console.WriteLine("ВНИМАНИЕ: не задан токен в settings.json — отправка на сайт не сработает.");
            Console.WriteLine("Открой settings.json, вставь значение секрета STRESS_INGEST_TOKEN.\n");
        }

        // Режим командной строки: StressRunner.exe run "Имя профиля"
        if (args.Length >= 1 && args[0].Equals("run", StringComparison.OrdinalIgnoreCase))
        {
            string profileName = args.Length >= 2 ? args[1] : (profiles.FirstOrDefault()?.Name ?? "");
            var p = profiles.FirstOrDefault(x => x.Name.Equals(profileName, StringComparison.OrdinalIgnoreCase));
            if (p == null) { Console.WriteLine($"Профиль '{profileName}' не найден."); return 1; }
            await ExecuteProfile(p, settings, storage);
            return 0;
        }

        // Интерактивное меню
        while (true)
        {
            Console.WriteLine("\nМеню:");
            Console.WriteLine("  Профили:");
            for (int i = 0; i < profiles.Count; i++)
                Console.WriteLine($"    {i + 1}. {profiles[i].Name}  ({profiles[i].Tests.Count} тестов)");
            Console.WriteLine("  d. Дослать неотправленные прогоны");
            Console.WriteLine("  q. Выход");
            Console.Write("\nВыбор: ");
            string? choice = Console.ReadLine()?.Trim();

            if (string.IsNullOrEmpty(choice)) continue;
            if (choice == "q") break;
            if (choice == "d") { await ResendUnsent(settings, storage); continue; }

            if (int.TryParse(choice, out int n) && n >= 1 && n <= profiles.Count)
                await ExecuteProfile(profiles[n - 1], settings, storage);
            else
                Console.WriteLine("Не понял выбор.");
        }

        return 0;
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
                Console.WriteLine("Не доставлено — сохранено локально, дослать можно пунктом 'd'.");
        }
    }

    private static async Task ResendUnsent(AppSettings settings, Storage storage)
    {
        var unsent = storage.GetUnsent();
        if (unsent.Count == 0) { Console.WriteLine("Все прогоны уже отправлены."); return; }
        Console.WriteLine($"Не отправлено: {unsent.Count}. Досылаю...");
        var up = new Uploader(settings);
        foreach (var (uid, jsonPayload) in unsent)
        {
            if (await up.SendAsync(jsonPayload))
            {
                storage.MarkSent(uid);
                Console.WriteLine($"  {uid} — ок");
            }
        }
    }

    // ─── Загрузка/создание конфигов ───────────────────────────────────────

    private static AppSettings LoadSettings()
    {
        string path = Path("settings.json");
        if (!File.Exists(path))
        {
            var def = new AppSettings();
            File.WriteAllText(path, JsonSerializer.Serialize(def, JsonOpts));
            Console.WriteLine($"Создан {path} — впиши токен и URL.\n");
            return def;
        }
        return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path)) ?? new AppSettings();
    }

    private static List<Profile> LoadProfiles()
    {
        string path = Path("profiles.json");
        if (!File.Exists(path))
        {
            var def = new List<Profile>
            {
                new Profile
                {
                    Name = "Пример: проверка ПК",
                    Note = "Демо-профиль. Замени программы на реальные (OCCT, Prime95, FurMark...).",
                    Tests = new List<TestItem>
                    {
                        new TestItem
                        {
                            Name = "CPU stress (пример ping вместо утилиты)",
                            Program = "ping.exe",
                            Args = "-n 10 127.0.0.1",
                            DurationSec = 12,
                            TimeoutIsSuccess = true,
                            SuccessExitCode = 0,
                            ReportFiles = new List<string>(),
                        },
                        new TestItem
                        {
                            Name = "Свой bat-скрипт",
                            Program = @"C:\stress\my_test.bat",
                            Args = "",
                            DurationSec = 60,
                            TimeoutIsSuccess = true,
                            ReportFiles = new List<string> { @"C:\stress\*.log" },
                        },
                    },
                },
            };
            File.WriteAllText(path, JsonSerializer.Serialize(def, JsonOpts));
            Console.WriteLine($"Создан {path} с примером — отредактируй под свои тесты.\n");
            return def;
        }
        return JsonSerializer.Deserialize<List<Profile>>(File.ReadAllText(path)) ?? new List<Profile>();
    }
}
