using System.Diagnostics;
using System.IO;

namespace StressRunner;

/// <summary>
/// Движок: запускает тесты из профиля по очереди, каждый на своё время,
/// собирает код завершения, длительность и файлы-отчёты.
/// </summary>
public class Runner
{
    private readonly AppSettings _settings;

    /// <summary>Лог-сообщение для UI (необязательно). Вызывается из фонового потока.</summary>
    public Action<string>? OnLog;
    /// <summary>Прогресс: (номер теста, всего тестов, имя теста). Для UI.</summary>
    public Action<int, int, string>? OnTestStart;
    /// <summary>Результат теста готов: (успех, имя теста). Для UI.</summary>
    public Action<bool, string>? OnTestDone;

    public Runner(AppSettings settings)
    {
        _settings = settings;
    }

    private void Log(string msg)
    {
        Console.WriteLine(msg);
        OnLog?.Invoke(msg);
    }

    public RunPayload RunProfile(Profile profile)
    {
        var run = new RunPayload
        {
            RunUid = Guid.NewGuid().ToString("N"),
            ProfileName = profile.Name,
            MachineName = string.IsNullOrWhiteSpace(_settings.MachineName)
                ? Environment.MachineName : _settings.MachineName,
            OsInfo = $"{Environment.OSVersion} · {Environment.ProcessorCount} ядер",
            Note = profile.Note,
            StartedAt = DateTime.UtcNow.ToString("o"),
        };

        Log($"=== Профиль: {profile.Name} ({profile.Tests.Count} тестов) ===");

        int idx = 0;
        foreach (var test in profile.Tests)
        {
            idx++;
            Log($"[{idx}/{profile.Tests.Count}] {test.Name} — {test.DurationSec} сек");
            OnTestStart?.Invoke(idx, profile.Tests.Count, test.Name);
            var res = RunSingle(test);
            run.Results.Add(res);
            Log(res.Success
                ? $"    OK (код {res.ExitCode?.ToString() ?? "—"}, {res.DurationSec:F0} сек{(res.TimedOut ? ", по таймауту" : "")})"
                : $"    ОШИБКА (код {res.ExitCode?.ToString() ?? "—"}, {res.DurationSec:F0} сек)");
            OnTestDone?.Invoke(res.Success, test.Name);
        }

        run.FinishedAt = DateTime.UtcNow.ToString("o");
        int failed = run.Results.Count(r => !r.Success);
        run.Status = failed == 0 ? "completed" : "partial";
        return run;
    }

    private ResultPayload RunSingle(TestItem test)
    {
        var result = new ResultPayload
        {
            TestName = test.Name,
            Command = $"{test.Program} {test.Args}".Trim(),
            PlannedSec = test.DurationSec,
            StartedAt = DateTime.UtcNow.ToString("o"),
        };

        var sw = Stopwatch.StartNew();
        Process? proc = null;
        try
        {
            var psi = BuildStartInfo(test);
            proc = Process.Start(psi);
            if (proc == null)
            {
                result.Success = false;
                result.ExitCode = -1;
                result.DurationSec = 0;
                result.FinishedAt = DateTime.UtcNow.ToString("o");
                return result;
            }

            bool exitedInTime = proc.WaitForExit(test.DurationSec * 1000);
            sw.Stop();

            if (!exitedInTime)
            {
                // Время вышло — гасим процесс (и его детей).
                result.TimedOut = true;
                KillTree(proc);
                result.ExitCode = null;
                result.Success = test.TimeoutIsSuccess;
            }
            else
            {
                result.ExitCode = proc.ExitCode;
                bool codeOk = test.SuccessExitCode == -1 || proc.ExitCode == test.SuccessExitCode;

                // Защита от GUI-лаунчеров (OCCT, FurMark): процесс мог «открыть
                // окно и сразу выйти». Если завершился раньше min_run_sec — провал.
                if (test.MinRunSec > 0 && sw.Elapsed.TotalSeconds < test.MinRunSec)
                {
                    result.Success = false;
                    Log($"    Завершился за {sw.Elapsed.TotalSeconds:F0} сек — это раньше минимума ({test.MinRunSec} сек). Похоже, программа открыла окно и вышла. Проверь аргументы запуска теста на время.");
                }
                else
                {
                    result.Success = codeOk;
                }
            }
        }
        catch (Exception ex)
        {
            sw.Stop();
            Console.WriteLine($"    Не удалось запустить: {ex.Message}");
            result.Success = false;
            result.ExitCode = -1;
        }
        finally
        {
            proc?.Dispose();
        }

        result.DurationSec = sw.Elapsed.TotalSeconds;
        result.FinishedAt = DateTime.UtcNow.ToString("o");

        if (_settings.UploadFiles)
            CollectReports(test, result);

        return result;
    }

    private static ProcessStartInfo BuildStartInfo(TestItem test)
    {
        // Относительные пути (StressTests\OCCT\OCCT.exe) разворачиваются от
        // корня StressRunner — поэтому портативно на любом ПК.
        string exePath = Paths.Resolve(test.Program);
        string program = exePath;
        string args = Environment.ExpandEnvironmentVariables(test.Args);
        string workDir = string.IsNullOrWhiteSpace(test.WorkingDir) ? "" : Paths.Resolve(test.WorkingDir);
        string ext = Path.GetExtension(program).ToLowerInvariant();

        // Скрипты запускаем через нужный интерпретатор.
        if (ext is ".bat" or ".cmd")
        {
            args = $"/c \"{exePath}\" {args}";
            program = "cmd.exe";
        }
        else if (ext == ".ps1")
        {
            args = $"-ExecutionPolicy Bypass -File \"{exePath}\" {args}";
            program = "powershell.exe";
        }

        var psi = new ProcessStartInfo
        {
            FileName = program,
            Arguments = args,
            UseShellExecute = false,
            CreateNoWindow = false,
        };
        if (!string.IsNullOrWhiteSpace(workDir))
            psi.WorkingDirectory = workDir;
        else if (File.Exists(exePath))
            psi.WorkingDirectory = Path.GetDirectoryName(Path.GetFullPath(exePath)) ?? "";
        return psi;
    }

    private static void KillTree(Process proc)
    {
        try { proc.Kill(entireProcessTree: true); proc.WaitForExit(5000); }
        catch { /* процесс уже мёртв */ }
    }

    private void CollectReports(TestItem test, ResultPayload result)
    {
        long maxBytes = (long)_settings.MaxFileMb * 1024 * 1024;
        foreach (var rawPattern in test.ReportFiles)
        {
            try
            {
                // Разворачиваем переменные и относительные пути (от корня exe).
                string pattern = Paths.Resolve(rawPattern);
                string dir = Path.GetDirectoryName(pattern) ?? ".";
                if (string.IsNullOrWhiteSpace(dir)) dir = ".";
                string mask = Path.GetFileName(pattern);
                if (!Directory.Exists(dir)) continue;

                foreach (var file in Directory.GetFiles(dir, mask))
                {
                    var fi = new FileInfo(file);
                    if (fi.Length == 0 || fi.Length > maxBytes) continue;
                    byte[] bytes = File.ReadAllBytes(file);
                    result.Files.Add(new FilePayload
                    {
                        Name = fi.Name,
                        ContentBase64 = Convert.ToBase64String(bytes),
                    });
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"    Не смог забрать отчёт {pattern}: {ex.Message}");
            }
        }
    }
}