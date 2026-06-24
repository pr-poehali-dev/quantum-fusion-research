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

        // Выбираем ОСНОВНОЙ GPU (если в системе несколько — берём дискретный,
        // а не встроенную графику). Метрики GPU собираем только с него.
        string mainGpu = PickMainGpu(sensors);

        lock (_lock)
        {
            foreach (var s in sensors)
            {
                string hw = s.Hardware.ToLowerInvariant();
                string nm = s.Name.ToLowerInvariant();
                bool isCpu = IsCpu(hw);
                bool isGpu = IsGpu(hw) && s.Hardware == mainGpu;
                bool isRamTemp = (hw.Contains("memory") || hw.Contains("dimm") || hw.Contains("spd")
                                  || nm.Contains("dimm") || nm.Contains("spd")) && !isCpu && !IsGpu(hw);

                switch (s.Type)
                {
                    case "Temperature":
                        // Температура планок ОЗУ (SPD). Каждая планка отдельно.
                        if (isRamTemp)
                            Put($"ram_temp::{s.Hardware}::{s.Name}", $"RAM {s.Name}", "°C", s.Value, 0, 120);
                        // CPU температура.
                        else if (isCpu && (nm.Contains("tctl") || nm.Contains("tdie") || nm.Contains("package") || nm == "core average"))
                            Put("cpu_temp", "CPU температура", "°C", s.Value, 0, 120);
                        // GPU горячая точка — СТРОГО hot spot/hotspot (без junction!).
                        else if (isGpu && (nm.Contains("hot spot") || nm.Contains("hotspot")))
                            Put("gpu_hotspot", "GPU Hot Spot", "°C", s.Value, 0, 125);
                        // GPU память — Memory/Junction (но не hot spot).
                        else if (isGpu && (nm.Contains("memory") || nm.Contains("junction")))
                            Put("gpu_mem_temp", "GPU память", "°C", s.Value, 0, 120);
                        // GPU ядро.
                        else if (isGpu && (nm == "gpu core" || nm == "gpu" || nm == "temperature"))
                            Put("gpu_temp", "GPU температура (Core)", "°C", s.Value, 0, 125);
                        break;
                    case "Load":
                        if (isCpu && nm.Contains("cpu total"))
                            Put("cpu_load", "Нагрузка CPU", "%", s.Value);
                        else if (isGpu && nm == "gpu core")
                            Put("gpu_load", "Нагрузка GPU", "%", s.Value);
                        break;
                    case "Fan":
                        if (s.Value > 0)
                            Put($"fan::{s.Hardware}::{s.Name}", $"{s.Name} ({s.Hardware})", "RPM", s.Value);
                        break;
                    case "Clock":
                        if (isCpu && nm.StartsWith("core #1"))
                            Put("cpu_clock", "Частота CPU", "MHz", s.Value);
                        else if (isGpu && nm == "gpu core")
                            Put("gpu_clock", "Частота GPU", "MHz", s.Value);
                        break;
                    case "Power":
                        if (isCpu && nm == "package")
                            Put("cpu_power", "Потребление CPU", "W", s.Value);
                        else if (isGpu && nm == "gpu package")
                            Put("gpu_power", "Потребление GPU", "W", s.Value);
                        break;
                }
            }
        }
    }

    private static bool IsCpu(string hw)
        => hw.Contains("ryzen") || hw.Contains("intel") || hw.Contains("core i") || hw.Contains(" cpu");

    private static bool IsGpu(string hw)
        => hw.Contains("nvidia") || hw.Contains("geforce") || hw.Contains("radeon") || hw.Contains("rtx") || hw.Contains(" gpu");

    /// <summary>
    /// Если в системе несколько GPU — выбираем основной (дискретный).
    /// Приоритет: NVIDIA/GeForce/RTX → дискретный Radeon RX → всё остальное.
    /// Встроенная графика ("Radeon(TM) Graphics", "UHD", "Iris") идёт последней.
    /// </summary>
    private static string PickMainGpu(List<HardwareMonitor.Sensor> sensors)
    {
        var gpus = sensors
            .Where(s => IsGpu(s.Hardware.ToLowerInvariant()))
            .Select(s => s.Hardware)
            .Distinct()
            .ToList();
        if (gpus.Count == 0) return "";
        if (gpus.Count == 1) return gpus[0];

        int Score(string hw)
        {
            string h = hw.ToLowerInvariant();
            bool integrated = h.Contains("(tm) graphics") || h.Contains("uhd") || h.Contains("iris")
                              || h.Contains("vega") && h.Contains("graphics");
            if (integrated) return 0;
            if (h.Contains("nvidia") || h.Contains("geforce") || h.Contains("rtx")) return 3;
            if (h.Contains("radeon rx") || h.Contains("rx ")) return 2;
            return 1;
        }
        return gpus.OrderByDescending(Score).First();
    }

    private void Put(string key, string label, string unit, double v, double lo = double.NaN, double hi = double.NaN)
    {
        // Нули в температурах/оборотах/частотах — обычно «нет данных», пропускаем.
        if (v <= 0 && (unit == "°C" || unit == "RPM" || unit == "MHz")) return;
        // Отсев битых значений вне разумного диапазона (напр. GPU mem junction = 255°).
        if (!double.IsNaN(lo) && v < lo) return;
        if (!double.IsNaN(hi) && v > hi) return;
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