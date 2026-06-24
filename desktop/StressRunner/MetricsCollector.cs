namespace StressRunner;

/// <summary>
/// Копит показания датчиков во время прогона и считает min/max/avg по каждой
/// величине. Источник — LibreHardwareMonitor (HardwareMonitor), без HWiNFO.
///
/// Снимаем: температуры CPU/GPU, нагрузку CPU/GPU, обороты вентиляторов,
/// частоты и потребление (ватты). Сэмплируем раз в секунду во время теста.
/// </summary>
public class MetricsCollector
{
    private class Agg
    {
        public string Label = "";
        public string Unit = "";
        public double Min = double.MaxValue;
        public double Max = double.MinValue;
        public double Sum;
        public int Count;
        public void Add(double v)
        {
            if (v < Min) Min = v;
            if (v > Max) Max = v;
            Sum += v; Count++;
        }
    }

    // key -> агрегат. key = cpu_temp / gpu_temp / cpu_load / gpu_load / fan_<n> / clock_<n> / power_<n>
    private readonly Dictionary<string, Agg> _data = new();
    private readonly object _lock = new();

    /// <summary>Снять один сэмпл (вызывать раз в секунду во время теста).</summary>
    public void Sample()
    {
        var sensors = HardwareMonitor.Instance.ReadAll();
        if (sensors.Count == 0) return;

        lock (_lock)
        {
            foreach (var s in sensors)
            {
                string hw = s.Hardware.ToLowerInvariant();
                string nm = s.Name.ToLowerInvariant();
                bool isGpu = hw.Contains("nvidia") || hw.Contains("geforce") || hw.Contains("radeon") || hw.Contains("gpu");
                bool isCpu = hw.Contains("cpu") || hw.Contains("ryzen") || hw.Contains("intel") || hw.Contains("core i");

                switch (s.Type)
                {
                    case "Temperature":
                        if (isCpu && (nm.Contains("package") || nm.Contains("tctl") || nm.Contains("tdie") || nm.Contains("core (tctl") || nm == "core average"))
                            Put("cpu_temp", "CPU температура", "°C", s.Value);
                        else if (isGpu && (nm.Contains("core") || nm.Contains("gpu") || nm == "temperature" || nm == "hot spot"))
                            Put("gpu_temp", "GPU температура", "°C", s.Value);
                        break;
                    case "Load":
                        if (isCpu && (nm.Contains("cpu total") || nm == "total"))
                            Put("cpu_load", "Нагрузка CPU", "%", s.Value);
                        else if (isGpu && (nm.Contains("core") || nm.Contains("d3d") || nm == "gpu"))
                            Put("gpu_load", "Нагрузка GPU", "%", s.Value);
                        break;
                    case "Fan":
                        Put($"fan::{s.Hardware}::{s.Name}", $"{s.Name} ({s.Hardware})", "RPM", s.Value);
                        break;
                    case "Clock":
                        if (isCpu && nm.Contains("core") && !nm.Contains("bus"))
                            Put("cpu_clock", "Частота CPU", "MHz", s.Value);
                        else if (isGpu && nm.Contains("core"))
                            Put("gpu_clock", "Частота GPU", "MHz", s.Value);
                        break;
                    case "Power":
                        if (isCpu && (nm.Contains("package") || nm.Contains("cpu")))
                            Put("cpu_power", "Потребление CPU", "W", s.Value);
                        else if (isGpu && (nm.Contains("gpu") || nm.Contains("total") || nm.Contains("power")))
                            Put("gpu_power", "Потребление GPU", "W", s.Value);
                        break;
                }
            }
        }
    }

    private void Put(string key, string label, string unit, double v)
    {
        // Нули в температурах/оборотах/частотах — обычно «нет данных», пропускаем.
        if (v <= 0 && (unit == "°C" || unit == "RPM" || unit == "MHz")) return;
        if (!_data.TryGetValue(key, out var a))
        {
            a = new Agg { Label = label, Unit = unit };
            _data[key] = a;
        }
        a.Add(v);
    }

    /// <summary>Итоговые метрики (min/max/avg) для отправки на сайт.</summary>
    public List<MetricPayload> Build()
    {
        lock (_lock)
        {
            var list = new List<MetricPayload>();
            foreach (var (key, a) in _data)
            {
                if (a.Count == 0) continue;
                list.Add(new MetricPayload
                {
                    Key = key, Label = a.Label, Unit = a.Unit,
                    Min = Math.Round(a.Min, 1),
                    Max = Math.Round(a.Max, 1),
                    Avg = Math.Round(a.Sum / a.Count, 1),
                    Samples = a.Count,
                });
            }
            return list;
        }
    }
}