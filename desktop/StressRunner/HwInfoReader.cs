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

    /// <summary>Доступен ли HWiNFO (Shared Memory или реестр Gadget).</summary>
    public static bool IsAvailable()
    {
        if (HwInfoSharedMem.ReadAll(out _).Count > 0) return true;
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

            string dir = Path.GetDirectoryName(exe) ?? "";

            // Применяем сохранённые настройки HWiNFO из .reg (Shared Memory и пр.),
            // если файл лежит рядом. Тогда не нужно настраивать вручную.
            ImportReg(dir, log);

            // Бесплатная HWiNFO НЕ поддерживает ключи командной строки (только Pro),
            // поэтому запускаем БЕЗ аргументов.
            Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                WorkingDirectory = dir,
                UseShellExecute = true,
            });
            log?.Invoke("HWiNFO запущен. Если график пуст — в HWiNFO включи галку «Shared Memory Support» (один раз, дальше запомнит).");
        }
        catch (Exception ex)
        {
            log?.Invoke($"Не смог запустить HWiNFO: {ex.Message}");
        }
    }

    /// <summary>
    /// Импортировать HWiNFO64_settings.reg (если лежит рядом с EXE) через reg.exe.
    /// Это применяет заранее сохранённые настройки HWiNFO (Shared Memory и пр.).
    /// </summary>
    private static void ImportReg(string dir, Action<string>? log)
    {
        try
        {
            string reg = Path.Combine(dir, "HWiNFO64_settings.reg");
            if (!File.Exists(reg)) return;

            var p = Process.Start(new ProcessStartInfo
            {
                FileName = "reg.exe",
                Arguments = $"import \"{reg}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
            });
            p?.WaitForExit(5000);
            log?.Invoke("Настройки HWiNFO применены из HWiNFO64_settings.reg.");
        }
        catch (Exception ex)
        {
            log?.Invoke($"Не смог применить .reg HWiNFO: {ex.Message}");
        }
    }

    /// <summary>
    /// Снять текущие показания. Сначала пробуем Shared Memory (SM2), если её
    /// нет — реестр Gadget (VSB). Available=false если оба канала пусты.
    /// </summary>
    public Snapshot Read()
    {
        // 1) Shared Memory — основной канал.
        var sm = HwInfoSharedMem.ReadAll(out _);
        if (sm.Count > 0) return FromReadings(sm);

        // 2) Реестр Gadget — запасной.
        return FromRegistry();
    }

    private static Snapshot FromReadings(List<HwInfoSharedMem.Reading> readings)
    {
        var snap = new Snapshot { Available = true };
        foreach (var r in readings)
        {
            string l = r.Label.ToLowerInvariant();
            bool isTemp = r.Type == HwInfoSharedMem.ReadingType.Temp;
            bool isUsage = r.Type == HwInfoSharedMem.ReadingType.Usage;

            if (snap.CpuLoad == null && isUsage && l.Contains("cpu") && (l.Contains("total") || l.Contains("usage")))
                snap.CpuLoad = r.Value;
            else if (snap.GpuLoad == null && isUsage && l.Contains("gpu"))
                snap.GpuLoad = r.Value;
            else if (snap.CpuTemp == null && isTemp && l.Contains("cpu") && (l.Contains("package") || l.Contains("tctl") || l.Contains("tdie") || l.Contains("ccd")))
                snap.CpuTemp = r.Value;
            else if (snap.GpuTemp == null && isTemp && l.Contains("gpu"))
                snap.GpuTemp = r.Value;
        }
        // Если по точным меткам не нашли CPU temp — берём первый CPU temp.
        if (snap.CpuTemp == null)
            foreach (var r in readings)
                if (r.Type == HwInfoSharedMem.ReadingType.Temp && r.Label.ToLowerInvariant().Contains("cpu"))
                { snap.CpuTemp = r.Value; break; }
        return snap;
    }

    private Snapshot FromRegistry()
    {
        var snap = new Snapshot();
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(VsbPath);
            if (key == null) return snap;

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

    /// <summary>
    /// Для дебаг-окна: какой канал доступен и полный список сенсоров.
    /// </summary>
    public static (string status, List<HwInfoSharedMem.Reading> readings) Debug()
    {
        var sm = HwInfoSharedMem.ReadAll(out string smStatus);
        if (sm.Count > 0)
            return ($"Канал: Shared Memory. {smStatus}", sm);

        // Реестр → отдадим как readings (упрощённо).
        var list = new List<HwInfoSharedMem.Reading>();
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(VsbPath);
            if (key != null)
            {
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
                    values.TryGetValue(i, out var raw);
                    list.Add(new HwInfoSharedMem.Reading { Label = label, Unit = raw ?? "", Value = ParseNumber(raw ?? "") ?? 0 });
                }
                if (list.Count > 0)
                    return ($"Канал: реестр Gadget (Shared Memory недоступна: {smStatus}). Сенсоров: {list.Count}", list);
            }
        }
        catch { }

        return ($"HWiNFO не отдаёт данные. {smStatus} Реестр Gadget тоже пуст. Проверь, что HWiNFO запущен и включён Shared Memory или Gadget.", list);
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