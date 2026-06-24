using System.Diagnostics;
using System.IO;
using Microsoft.Win32;

namespace StressRunner;

/// <summary>
/// Читает сенсоры из HWiNFO через реестр (Gadget / VSB).
///
/// Чтобы это работало, в HWiNFO нужно включить:
///   Settings → "Shared Memory Support" ИЛИ кнопка Gadget (значок) у нужных
///   сенсоров → они появятся в реестре HKCU\Software\HWiNFO64\VSB.
/// Каждый сенсор там лежит как пара ключей:
///   LabelN (название, напр. "Total CPU Usage") и ValueN ("37.0 %").
/// </summary>
public class HwInfoReader
{
    private const string VsbPath = @"Software\HWiNFO64\VSB";

    public class Snapshot
    {
        public double? CpuLoad;     // %
        public double? GpuLoad;     // %
        public double? CpuTemp;     // °C
        public double? GpuTemp;     // °C
        public bool Available;      // нашли ли вообще данные HWiNFO
    }

    /// <summary>Доступен ли HWiNFO (есть ли ветка VSB в реестре).</summary>
    public static bool IsAvailable()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(VsbPath);
            return key != null && key.GetValueNames().Length > 0;
        }
        catch { return false; }
    }

    /// <summary>
    /// Запустить HWiNFO в фоне, если он положен в StressTests\HWinfo (или указан
    /// путь в settings) и ещё не запущен. Без него график пустой.
    /// </summary>
    public static void EnsureRunning(AppSettings settings, Action<string>? log = null)
    {
        try
        {
            // Уже запущен?
            if (Process.GetProcessesByName("HWiNFO64").Length > 0 ||
                Process.GetProcessesByName("HWiNFO32").Length > 0)
                return;

            // Ищем exe: сначала из settings, потом типовые места в StressTests.
            string[] candidates =
            {
                string.IsNullOrWhiteSpace(settings.HwInfoPath) ? "" : Paths.Resolve(settings.HwInfoPath),
                Paths.Resolve(@"StressTests\HWinfo\HWiNFO64.EXE"),
                Paths.Resolve(@"StressTests\HWiNFO\HWiNFO64.EXE"),
                Paths.Resolve(@"StressTests\HWinfo\HWiNFO64.exe"),
            };

            string? exe = null;
            foreach (var c in candidates)
                if (!string.IsNullOrWhiteSpace(c) && File.Exists(c)) { exe = c; break; }

            if (exe == null)
            {
                log?.Invoke("HWiNFO не найден в StressTests\\HWinfo — график будет пустым. Положи туда HWiNFO64.EXE.");
                return;
            }

            // Пишем INI рядом с EXE: включаем Shared Memory + Gadget, прячем окна,
            // отключаем автообновления/всплывашки. Юзеру ничего настраивать не надо.
            string dir = Path.GetDirectoryName(exe) ?? "";
            WriteIni(dir, log);

            Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Arguments = "-minimize",   // свёрнуто в трей
                WorkingDirectory = dir,
                UseShellExecute = true,
            });
            log?.Invoke("HWiNFO запущен в фоне (свёрнут в трей). Мониторинг включён автоматически.");
        }
        catch (Exception ex)
        {
            log?.Invoke($"Не смог запустить HWiNFO: {ex.Message}");
        }
    }

    /// <summary>
    /// Создать HWiNFO64.INI рядом с EXE (если его ещё нет), чтобы HWiNFO сразу
    /// работал «как надо»: только сенсоры, Shared Memory + Gadget включены,
    /// окна свёрнуты, без автообновлений и приветствий. Юзер ничего не настраивает.
    /// Существующий INI не перезаписываем — вдруг юзер уже настроил под себя.
    /// </summary>
    private static void WriteIni(string dir, Action<string>? log)
    {
        try
        {
            string ini = Path.Combine(dir, "HWiNFO64.INI");
            if (File.Exists(ini)) return;

            string[] lines =
            {
                "[Settings]",
                "SensorsOnly=1",            // запускать только окно датчиков
                "SummaryOnly=0",
                "OpenSystemSummary=0",      // не открывать сводку системы
                "ShowWelcomeAndProgress=0", // без экрана приветствия
                "MinimizeMainOnStartup=1",  // главное окно свёрнуто
                "MinimizeSensorsOnStartup=1",// окно датчиков свёрнуто
                "MinimizeSensorsToTray=1",  // в трей
                "AutoUpdateBetaCheck=0",
                "DisableAutoUpdate=1",
                "RememberSettings=1",
                "SensorsSHM=1",             // Shared Memory — наш канал чтения
                "EnableGadget=1",           // Gadget/VSB в реестр (резервный канал)
                "GadgetVSB=1",
                "SensorsPollingPeriod=1000",// опрос раз в секунду
            };
            File.WriteAllLines(ini, lines);
            log?.Invoke("Создан конфиг HWiNFO (мониторинг настроен автоматически).");
        }
        catch (Exception ex)
        {
            log?.Invoke($"Не смог создать конфиг HWiNFO: {ex.Message}");
        }
    }

    /// <summary>Снять текущие показания. Если HWiNFO нет — Available=false.</summary>
    public Snapshot Read()
    {
        var snap = new Snapshot();
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(VsbPath);
            if (key == null) return snap;

            // Собираем пары LabelN -> ValueN.
            var labels = new Dictionary<int, string>();
            var values = new Dictionary<int, string>();
            foreach (var name in key.GetValueNames())
            {
                if (name.StartsWith("Label") && int.TryParse(name[5..], out int li))
                    labels[li] = key.GetValue(name)?.ToString() ?? "";
                else if (name.StartsWith("Value") && int.TryParse(name[5..], out int vi))
                    values[vi] = key.GetValue(name)?.ToString() ?? "";
            }

            foreach (var (i, label) in labels)
            {
                if (!values.TryGetValue(i, out var raw)) continue;
                double? v = ParseNumber(raw);
                if (v == null) continue;
                string l = label.ToLowerInvariant();

                if (snap.CpuLoad == null && (l.Contains("total cpu usage") || l.Contains("cpu total") || (l.Contains("cpu") && l.Contains("usage"))))
                    snap.CpuLoad = v;
                else if (snap.GpuLoad == null && l.Contains("gpu") && (l.Contains("usage") || l.Contains("utilization") || l.Contains("load")))
                    snap.GpuLoad = v;
                else if (snap.CpuTemp == null && l.Contains("cpu") && (l.Contains("temp") || l.Contains("package") || l.Contains("tctl")))
                    snap.CpuTemp = v;
                else if (snap.GpuTemp == null && l.Contains("gpu") && l.Contains("temp"))
                    snap.GpuTemp = v;
            }

            snap.Available = labels.Count > 0;
        }
        catch { /* нет доступа — оставим Available=false */ }
        return snap;
    }

    private static double? ParseNumber(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        // "37.0 %", "65.5 °C", "1,234 MHz" → берём первое число
        var sb = new System.Text.StringBuilder();
        foreach (char c in raw)
        {
            if (char.IsDigit(c)) sb.Append(c);
            else if ((c == '.' || c == ',') && sb.Length > 0) sb.Append('.');
            else if (sb.Length > 0) break;
        }
        if (sb.Length == 0) return null;
        return double.TryParse(sb.ToString(), System.Globalization.NumberStyles.Any,
            System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : null;
    }
}