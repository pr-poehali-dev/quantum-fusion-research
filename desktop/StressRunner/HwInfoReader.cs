namespace StressRunner;

/// <summary>
/// Источник датчиков для приложения. Теперь работает через LibreHardwareMonitor
/// (HardwareMonitor) — HWiNFO больше НЕ нужен. Имя класса и публичные методы
/// сохранены для совместимости с остальным кодом.
/// </summary>
public class HwInfoReader
{
    public class Snapshot
    {
        public double? CpuLoad;     // %
        public double? GpuLoad;     // %
        public double? CpuTemp;     // °C
        public double? GpuTemp;     // °C
        public bool Available;
    }

    /// <summary>Доступны ли датчики вообще.</summary>
    public static bool IsAvailable() => HardwareMonitor.Instance.ReadAll().Count > 0;

    /// <summary>Раньше запускал HWiNFO — теперь ничего не нужно (LHM встроен).</summary>
    public static void EnsureRunning(AppSettings settings, Action<string>? log = null)
    {
        log?.Invoke("Датчики читаются напрямую (LibreHardwareMonitor) — HWiNFO не требуется.");
    }

    /// <summary>Текущие ключевые показания (для плиток в главном окне).</summary>
    public Snapshot Read()
    {
        var snap = new Snapshot();
        var sensors = HardwareMonitor.Instance.ReadAll();
        if (sensors.Count == 0) return snap;
        snap.Available = true;

        foreach (var s in sensors)
        {
            string hw = s.Hardware.ToLowerInvariant();
            string nm = s.Name.ToLowerInvariant();
            bool isGpu = hw.Contains("nvidia") || hw.Contains("amd radeon") || hw.Contains("gpu") || hw.Contains("geforce") || hw.Contains("radeon");
            bool isCpu = hw.Contains("cpu") || hw.Contains("ryzen") || hw.Contains("core i") || hw.Contains("intel");

            if (s.Type == "Temperature")
            {
                if (snap.CpuTemp == null && isCpu && (nm.Contains("tctl") || nm.Contains("tdie") || nm.Contains("package")))
                    snap.CpuTemp = s.Value;
                else if (snap.GpuTemp == null && isGpu && nm == "gpu core")
                    snap.GpuTemp = s.Value;
            }
            else if (s.Type == "Load")
            {
                if (snap.CpuLoad == null && isCpu && nm.Contains("cpu total"))
                    snap.CpuLoad = s.Value;
                else if (snap.GpuLoad == null && isGpu && nm == "gpu core")
                    snap.GpuLoad = s.Value;
            }
        }
        return snap;
    }

    /// <summary>Для дебаг-окна: статус + полный список датчиков.</summary>
    public static (string status, List<HardwareMonitor.Sensor> readings) Debug()
    {
        var sensors = HardwareMonitor.Instance.ReadAll();
        if (sensors.Count == 0)
            return ("Датчики не читаются. Запусти приложение от имени администратора.", sensors);
        return ($"LibreHardwareMonitor OK: {sensors.Count} датчиков.", sensors);
    }
}