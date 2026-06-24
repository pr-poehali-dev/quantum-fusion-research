using System.Diagnostics;

namespace StressRunner;

/// <summary>
/// Движок: запускает тесты из профиля по очереди, каждый на своё время,
/// собирает код завершения, длительность и файлы-отчёты.
/// </summary>
public class Runner
{
    private readonly AppSettings _settings;

    public Runner(AppSettings settings)
    {
        _settings = settings;
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

        Console.WriteLine($"\n=== Профиль: {profile.Name} ({profile.Tests.Count} тестов) ===\n");

        int idx = 0;
        foreach (var test in profile.Tests)
        {
            idx++;
            Console.WriteLine($"[{idx}/{profile.Tests.Count}] {test.Name} — {test.DurationSec} сек");
            var res = RunSingle(test);
            run.Results.Add(res);
            Console.WriteLine(res.Success
                ? $"    OK (код {res.ExitCode?.ToString() ?? "—"}, {res.DurationSec:F0} сек{(res.TimedOut ? ", по таймауту" : "")})"
                : $"    ОШИБКА (код {res.ExitCode?.ToString() ?? "—"}, {res.DurationSec:F0} сек)");
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
                result.Success = test.SuccessExitCode == -1 || proc.ExitCode == test.SuccessExitCode;
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
        string program = test.Program;
        string args = test.Args;
        string ext = Path.GetExtension(program).ToLowerInvariant();

        // Скрипты запускаем через нужный интерпретатор.
        if (ext is ".bat" or ".cmd")
        {
            args = $"/c \"{program}\" {args}";
            program = "cmd.exe";
        }
        else if (ext == ".ps1")
        {
            args = $"-ExecutionPolicy Bypass -File \"{test.Program}\" {test.Args}";
            program = "powershell.exe";
        }

        var psi = new ProcessStartInfo
        {
            FileName = program,
            Arguments = args,
            UseShellExecute = false,
            CreateNoWindow = false,
        };
        if (!string.IsNullOrWhiteSpace(test.WorkingDir))
            psi.WorkingDirectory = test.WorkingDir;
        else if (File.Exists(test.Program))
            psi.WorkingDirectory = Path.GetDirectoryName(Path.GetFullPath(test.Program)) ?? "";
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
        foreach (var pattern in test.ReportFiles)
        {
            try
            {
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
