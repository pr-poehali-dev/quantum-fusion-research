using LibreHardwareMonitor.Hardware;

namespace StressRunner;

/// <summary>
/// Чтение датчиков напрямую через LibreHardwareMonitor — БЕЗ HWiNFO.
/// Библиотека сама опрашивает железо (нужны права администратора, они уже есть).
/// Метки и значения всегда из одного объекта-сенсора, ничего не «съезжает».
/// </summary>
public sealed class HardwareMonitor : IDisposable
{
    private static readonly Lazy<HardwareMonitor> _inst = new(() => new HardwareMonitor());
    public static HardwareMonitor Instance => _inst.Value;

    private readonly Computer _computer;
    private readonly object _lock = new();

    private class UpdateVisitor : IVisitor
    {
        public void VisitComputer(IComputer c) => c.Traverse(this);
        public void VisitHardware(IHardware h)
        {
            h.Update();
            foreach (var sub in h.SubHardware) sub.Accept(this);
        }
        public void VisitSensor(ISensor s) { }
        public void VisitParameter(IParameter p) { }
    }

    private readonly UpdateVisitor _visitor = new();

    private HardwareMonitor()
    {
        _computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMotherboardEnabled = true,
            IsMemoryEnabled = true,
            IsStorageEnabled = false,
            IsNetworkEnabled = false,
        };
        try { _computer.Open(); } catch { }
    }

    public class Sensor
    {
        public string Hardware = "";
        public string Name = "";
        public string Type = "";   // Temperature, Load, Fan, Clock, Power, Voltage...
        public string Unit = "";
        public double Value;
    }

    /// <summary>Снять все сенсоры (один опрос железа).</summary>
    public List<Sensor> ReadAll()
    {
        var list = new List<Sensor>();
        lock (_lock)
        {
            try { _computer.Accept(_visitor); } catch { return list; }

            foreach (var hw in _computer.Hardware)
                Collect(hw, list);
        }
        return list;
    }

    private static void Collect(IHardware hw, List<Sensor> list)
    {
        foreach (var s in hw.Sensors)
        {
            if (s.Value == null) continue;
            list.Add(new Sensor
            {
                Hardware = hw.Name,
                Name = s.Name,
                Type = s.SensorType.ToString(),
                Unit = UnitFor(s.SensorType),
                Value = s.Value.Value,
            });
        }
        foreach (var sub in hw.SubHardware)
            Collect(sub, list);
    }

    private static string UnitFor(SensorType t) => t switch
    {
        SensorType.Temperature => "°C",
        SensorType.Load => "%",
        SensorType.Fan => "RPM",
        SensorType.Clock => "MHz",
        SensorType.Power => "W",
        SensorType.Voltage => "V",
        SensorType.Data => "GB",
        SensorType.Throughput => "B/s",
        _ => "",
    };

    public void Dispose()
    {
        try { _computer.Close(); } catch { }
    }
}
