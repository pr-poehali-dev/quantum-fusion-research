namespace StressRunner;

/// <summary>
/// Копит показания датчиков во время прогона и считает min/max/avg по каждой
/// величине. Источник — HWiNFO Shared Memory (или реестр через HwInfoReader).
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

    /// <summary>Снять один сэмпл из HWiNFO (вызывать раз в секунду во время теста).</summary>
    public void Sample()
    {
        var readings = HwInfoSharedMem.ReadAll(out _);
        if (readings.Count == 0) return;

        lock (_lock)
        {
            int fanIdx = 0, clockIdx = 0, powerIdx = 0;
            foreach (var r in readings)
            {
                string l = r.Label.ToLowerInvariant();
                switch (r.Type)
                {
                    case HwInfoSharedMem.ReadingType.Temp:
                        if (l.Contains("cpu") && (l.Contains("package") || l.Contains("tctl") || l.Contains("tdie") || l.Contains("ccd")))
                            Put("cpu_temp", "CPU температура", "°C", r.Value);
                        else if (l.Contains("gpu") && l.Contains("temp"))
                            Put("gpu_temp", "GPU температура", "°C", r.Value);
                        break;
                    case HwInfoSharedMem.ReadingType.Usage:
                        if (l.Contains("cpu") && (l.Contains("total") || l.Contains("usage")))
                            Put("cpu_load", "Нагрузка CPU", "%", r.Value);
                        else if (l.Contains("gpu") && !l.Contains("mem"))
                            Put("gpu_load", "Нагрузка GPU", "%", r.Value);
                        break;
                    case HwInfoSharedMem.ReadingType.Fan:
                        Put($"fan_{fanIdx++}", r.Label, "RPM", r.Value);
                        break;
                    case HwInfoSharedMem.ReadingType.Clock:
                        // только значимые частоты CPU/GPU, чтобы не плодить десятки
                        if (l.Contains("gpu") || l.Contains("core") || l.Contains("cpu"))
                            Put($"clock_{clockIdx++}", r.Label, "MHz", r.Value);
                        break;
                    case HwInfoSharedMem.ReadingType.Power:
                        if (l.Contains("cpu") || l.Contains("gpu") || l.Contains("package"))
                            Put($"power_{powerIdx++}", r.Label, "W", r.Value);
                        break;
                }
            }
        }
    }

    private void Put(string key, string label, string unit, double v)
    {
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
