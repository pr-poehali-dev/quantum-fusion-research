using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace StressRunner;

public partial class MainWindow : Window
{
    private readonly AppSettings _settings;
    private List<Profile> _profiles = new();
    private Storage _storage = null!;
    private readonly HwInfoReader _hw = new();
    private readonly DispatcherTimer _sensorTimer = new();
    private readonly Queue<double> _cpuHist = new();
    private readonly Queue<double> _gpuHist = new();
    private const int MaxPoints = 120;
    private bool _running;

    private static string AppDir => AppContext.BaseDirectory;
    private static string PathOf(string f) => System.IO.Path.Combine(AppDir, f);

    public MainWindow()
    {
        InitializeComponent();
        _settings = LoadSettings();
        _storage = new Storage(PathOf("stressrunner.db"));
        MachineLabel.Text = string.IsNullOrWhiteSpace(_settings.MachineName)
            ? Environment.MachineName : _settings.MachineName;

        StartBtn.Click += async (_, _) => await StartRun();
        StopBtn.Click += (_, _) => _running = false;
        ReloadBtn.Click += async (_, _) => await ReloadProfiles();

        _sensorTimer.Interval = TimeSpan.FromMilliseconds(1000);
        _sensorTimer.Tick += (_, _) => TickSensors();
        _sensorTimer.Start();

        if (!HwInfoReader.IsAvailable())
            HwInfoHint.Text = "HWiNFO не найден. Запусти HWiNFO и включи «Shared Memory Support», чтобы видеть график.";
        else
            HwInfoHint.Text = "HWiNFO подключён. График показывает реальную загрузку.";

        Loaded += async (_, _) => await ReloadProfiles();
    }

    // ─── Настройки / профили ───

    private AppSettings LoadSettings()
    {
        try
        {
            string p = PathOf("settings.json");
            if (File.Exists(p))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(p)) ?? new AppSettings();
        }
        catch { }
        var s = new AppSettings();
        File.WriteAllText(PathOf("settings.json"), JsonSerializer.Serialize(s, new JsonSerializerOptions { WriteIndented = true }));
        return s;
    }

    private void LoadLocalProfiles()
    {
        try
        {
            string p = PathOf("profiles.json");
            if (File.Exists(p))
                _profiles = JsonSerializer.Deserialize<List<Profile>>(File.ReadAllText(p)) ?? new();
        }
        catch { _profiles = new(); }
        BindProfiles();
    }

    private async Task ReloadProfiles()
    {
        if (!string.IsNullOrWhiteSpace(_settings.Token))
        {
            AppendLog("Загружаю профили с сайта...");
            var up = new Uploader(_settings);
            var pulled = await up.PullProfilesAsync();
            if (pulled != null && pulled.Count > 0)
            {
                _profiles = pulled;
                try { File.WriteAllText(PathOf("profiles.json"), JsonSerializer.Serialize(pulled, new JsonSerializerOptions { WriteIndented = true })); } catch { }
                AppendLog($"Загружено профилей: {pulled.Count}");
                BindProfiles();
                return;
            }
            AppendLog("Не удалось загрузить с сайта — беру локальные.");
        }
        LoadLocalProfiles();
    }

    private void BindProfiles()
    {
        ProfileBox.Items.Clear();
        foreach (var p in _profiles)
            ProfileBox.Items.Add($"{p.Name}  ({p.Tests.Count} тестов)");
        if (ProfileBox.Items.Count > 0) ProfileBox.SelectedIndex = 0;
    }

    // ─── Запуск прогона ───

    private async Task StartRun()
    {
        if (_running) return;
        int i = ProfileBox.SelectedIndex;
        if (i < 0 || i >= _profiles.Count) { AppendLog("Выбери профиль."); return; }
        var profile = _profiles[i];

        _running = true;
        StartBtn.IsEnabled = false;
        StopBtn.IsEnabled = true;
        ProfileBox.IsEnabled = false;
        StatusDot.Foreground = (Brush)FindResource("Accent");
        LogBox.Clear();

        var runner = new Runner(_settings);
        runner.OnLog = msg => Dispatcher.Invoke(() => AppendLog(msg));
        runner.OnTestStart = (idx, total, name) => Dispatcher.Invoke(() =>
        {
            CurrentTest.Text = $"[{idx}/{total}] {name}";
            ProgressFill.Width = (ActualWidthOfProgress() * (idx - 1)) / Math.Max(total, 1);
        });
        runner.OnTestDone = (ok, name) => Dispatcher.Invoke(() => { });

        RunPayload run = await Task.Run(() => runner.RunProfile(profile));

        // Сохраняем + отправляем
        string json = Uploader.Serialize(run);
        _storage.SaveRun(run, json);
        int passed = run.Results.Count(r => r.Success);
        AppendLog($"Итог: {passed}/{run.Results.Count} успешно.");

        if (!string.IsNullOrWhiteSpace(_settings.Token))
        {
            AppendLog("Отправляю результат на сайт...");
            var up = new Uploader(_settings);
            bool sent = await up.SendAsync(json);
            AppendLog(sent ? "Отправлено в админку." : "Не удалось отправить (сохранено локально).");
            if (sent) _storage.MarkSent(run.RunUid);
        }

        ProgressFill.Width = ActualWidthOfProgress();
        bool allOk = passed == run.Results.Count;
        StatusDot.Foreground = (Brush)FindResource(allOk ? "Ok" : "Primary");
        CurrentTest.Text = allOk ? "Готово — все тесты пройдены" : "Готово — есть ошибки";

        _running = false;
        StartBtn.IsEnabled = true;
        StopBtn.IsEnabled = false;
        ProfileBox.IsEnabled = true;
    }

    private double ActualWidthOfProgress()
    {
        var parent = ProgressFill.Parent as FrameworkElement;
        return parent?.ActualWidth ?? 0;
    }

    // ─── Сенсоры + график ───

    private void TickSensors()
    {
        var s = _hw.Read();
        CpuLoadVal.Text = s.CpuLoad.HasValue ? $"{s.CpuLoad:F0}%" : "—";
        GpuLoadVal.Text = s.GpuLoad.HasValue ? $"{s.GpuLoad:F0}%" : "—";
        CpuTempVal.Text = s.CpuTemp.HasValue ? $"{s.CpuTemp:F0}°" : "—";
        GpuTempVal.Text = s.GpuTemp.HasValue ? $"{s.GpuTemp:F0}°" : "—";

        Push(_cpuHist, s.CpuLoad ?? 0);
        Push(_gpuHist, s.GpuLoad ?? 0);
        DrawGraph();
    }

    private static void Push(Queue<double> q, double v)
    {
        q.Enqueue(Math.Clamp(v, 0, 100));
        while (q.Count > MaxPoints) q.Dequeue();
    }

    private void DrawGraph()
    {
        GraphCanvas.Children.Clear();
        double w = GraphCanvas.ActualWidth, h = GraphCanvas.ActualHeight;
        if (w <= 0 || h <= 0) return;

        // Сетка (0/50/100%)
        foreach (double frac in new[] { 0.0, 0.5, 1.0 })
        {
            double y = h * frac;
            GraphCanvas.Children.Add(new Line
            {
                X1 = 0, X2 = w, Y1 = y, Y2 = y,
                Stroke = (Brush)FindResource("Border"), StrokeThickness = 1,
            });
        }

        DrawSeries(_cpuHist, (Brush)FindResource("Primary"), w, h);
        DrawSeries(_gpuHist, (Brush)FindResource("Accent"), w, h);
    }

    private void DrawSeries(Queue<double> data, Brush color, double w, double h)
    {
        if (data.Count < 2) return;
        var pts = new PointCollection();
        var arr = data.ToArray();
        double step = w / (MaxPoints - 1);
        for (int i = 0; i < arr.Length; i++)
        {
            double x = w - (arr.Length - 1 - i) * step;
            double y = h - (arr[i] / 100.0 * h);
            pts.Add(new Point(x, y));
        }
        GraphCanvas.Children.Add(new Polyline
        {
            Points = pts, Stroke = color, StrokeThickness = 2,
            StrokeLineJoin = PenLineJoin.Round,
        });
    }

    // ─── Лог ───

    private void AppendLog(string msg)
    {
        LogBox.AppendText(msg + Environment.NewLine);
        LogScroll.ScrollToEnd();
    }
}