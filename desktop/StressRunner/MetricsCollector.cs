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
                        // CPU: "Core (Tctl/Tdie)" — основная температура процессора.
                        if (isCpu && (nm.Contains("tctl") || nm.Contains("tdie") || nm.Contains("package") || nm == "core average"))
                            Put("cpu_temp", "CPU температура", "°C", s.Value);
                        // GPU память: "GPU Memory Junction" — ВАЖНО проверять ДО hot spot,
                        // т.к. содержит "junction".
                        else if (isGpu && nm.Contains("memory"))
                            Put("gpu_mem_temp", "GPU память (Junction)", "°C", s.Value);
                        // GPU горячая точка: "GPU Hot Spot".
                        else if (isGpu && (nm.Contains("hot spot") || nm.Contains("hotspot") || nm.Contains("junction")))
                            Put("gpu_hotspot", "GPU Hot Spot", "°C", s.Value);
                        // GPU ядро: "GPU Core".
                        else if (isGpu && (nm == "gpu core" || nm == "gpu" || nm == "temperature"))
                            Put("gpu_temp", "GPU температура (Core)", "°C", s.Value);
                        break;
                    case "Load":
                        // CPU: "CPU Total".
                        if (isCpu && nm.Contains("cpu total"))
                            Put("cpu_load", "Нагрузка CPU", "%", s.Value);
                        // GPU: строго "GPU Core" (а не D3D/память — иначе мешанина).
                        else if (isGpu && nm == "gpu core")
                            Put("gpu_load", "Нагрузка GPU", "%", s.Value);
                        break;
                    case "Fan":
                        // Только реально вертящиеся (>0), чтобы не плодить нулевые.
                        if (s.Value > 0)
                            Put($"fan::{s.Hardware}::{s.Name}", $"{s.Name} ({s.Hardware})", "RPM", s.Value);
                        break;
                    case "Clock":
                        // CPU: берём первое ядро как репрезентативную частоту.
                        if (isCpu && nm.StartsWith("core #1"))
                            Put("cpu_clock", "Частота CPU", "MHz", s.Value);
                        // GPU: "GPU Core".
                        else if (isGpu && nm == "gpu core")
                            Put("gpu_clock", "Частота GPU", "MHz", s.Value);
                        break;
                    case "Power":
                        // CPU: "Package".
                        if (isCpu && nm == "package")
                            Put("cpu_power", "Потребление CPU", "W", s.Value);
                        // GPU: "GPU Package".
                        else if (isGpu && nm == "gpu package")
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