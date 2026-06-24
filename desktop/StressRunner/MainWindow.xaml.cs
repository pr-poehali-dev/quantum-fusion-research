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

    public MainWindow()
    {
        InitializeComponent();
        Paths.EnsureDirs();
        _settings = LoadSettings();
        _storage = new Storage(Paths.Db);

        // Применяем тему из настроек (тёмная/светлая + акцент).
        ThemeManager.Apply(_settings.ThemeMode, _settings.Accent, _settings.CustomAccent);

        MachineLabel.Text = string.IsNullOrWhiteSpace(_settings.MachineName)
            ? Environment.MachineName : _settings.MachineName;

        StartBtn.Click += async (_, _) => await StartRun();
        StopBtn.Click += (_, _) => _running = false;
        ReloadBtn.Click += async (_, _) => await ReloadProfiles();
        AuthBtn.Click += (_, _) => OpenAuth();
        ThemeBtn.Click += (_, _) => OpenTheme();
        OpenTestsBtn.Click += (_, _) => OpenTestsFolder();
        DebugBtn.Click += (_, _) => new DebugWindow { Owner = this }.ShowDialog();
        NetDiagBtn.Click += (_, _) => new NetDiagWindow(_settings) { Owner = this }.ShowDialog();
        ScaleDownBtn.Click += (_, _) => ChangeScale(-0.1);
        ScaleUpBtn.Click += (_, _) => ChangeScale(+0.1);

        ApplyScale(_settings.UiScale);
        RestoreWindowSize();

        // Сохраняем размер окна при ресайзе и при закрытии.
        SizeChanged += (_, _) => SaveWindowSize();
        StateChanged += (_, _) => SaveWindowSize();
        Closing += (_, _) => SaveWindowSize();

        UpdateAuthBadge();

        _sensorTimer.Interval = TimeSpan.FromMilliseconds(1000);
        _sensorTimer.Tick += (_, _) => TickSensors();
        _sensorTimer.Start();

        if (!HwInfoReader.IsAvailable())
            HwInfoHint.Text = "Датчики не читаются. Запусти приложение от имени администратора.";
        else
            HwInfoHint.Text = "Датчики читаются напрямую (без HWiNFO). График показывает реальную загрузку.";

        Loaded += async (_, _) =>
        {
            await SelfCheckNetwork();
            await ReloadProfiles();
        };
    }

    /// <summary>Быстрая проверка сети при старте — пишет краткий статус в лог.</summary>
    private async System.Threading.Tasks.Task SelfCheckNetwork()
    {
        AppendLog("Проверяю подключение к сайту...");
        var res = await NetDiag.RunAsync(_settings);
        // В основной лог — короткий итог, подробности в окне «Диагностика сети».
        foreach (var line in res.Log.ToString().Split('\n'))
        {
            string l = line.TrimEnd();
            if (l.Contains("ОШИБКА") || l.Contains("ТАЙМАУТ") || l.Contains("ИТОГ") || l.Contains("НЕ ОТКРЫЛСЯ") || l.Contains("✓") || l.Contains("✗"))
                AppendLog("  " + l);
        }
        if (!res.Ok)
            AppendLog("  Открой «🌐 Диагностика сети» для подробностей.");
    }

    // ─── Авторизация ───

    private void UpdateAuthBadge()
    {
        bool authed = !string.IsNullOrWhiteSpace(_settings.Token);
        string machine = string.IsNullOrWhiteSpace(_settings.MachineName)
            ? Environment.MachineName : _settings.MachineName;
        MachineLabel.Text = machine;

        if (authed)
        {
            AuthStatus.Text = "✓ Админ-режим включён";
            AuthStatus.Foreground = (Brush)FindResource("Ok");
            AuthSub.Text = $"ПК: {machine} · результаты уходят на сайт";
            AuthBtn.Content = "🔑 Сменить ключ / ПК";
        }
        else
        {
            AuthStatus.Text = "Не авторизован";
            AuthStatus.Foreground = (Brush)FindResource("Primary");
            AuthSub.Text = "Подключись к сайту, чтобы слать результаты";
            AuthBtn.Content = "🔑 Авторизоваться";
        }
    }

    private void OpenAuth()
    {
        var dlg = new AuthWindow(_settings) { Owner = this };
        bool? res = dlg.ShowDialog();
        if (res == true && dlg.Authorized)
        {
            // Настройки уже сохранены в settings.json — перезапускаем приложение.
            Restart();
        }
    }

    private void OpenTheme()
    {
        var dlg = new ThemeWindow(_settings, SaveSettings) { Owner = this };
        dlg.ShowDialog();
    }

    private void OpenTestsFolder()
    {
        try
        {
            Paths.EnsureDirs();
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = Paths.TestsDir, UseShellExecute = true,
            });
        }
        catch (Exception ex) { AppendLog($"Не смог открыть папку: {ex.Message}"); }
    }

    private void SaveSettings()
    {
        try
        {
            File.WriteAllText(Paths.Settings,
                JsonSerializer.Serialize(_settings, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }

    // ─── Масштаб интерфейса ───

    private void ChangeScale(double delta)
    {
        double s = Math.Clamp(Math.Round(_settings.UiScale + delta, 1), 0.8, 1.6);
        _settings.UiScale = s;
        ApplyScale(s);
        // Чтобы при увеличении масштаба контент не обрезался — окно может
        // подрасти, но НЕ меньше уже выбранного пользователем размера.
        Width = Math.Max(Width, BaseWidth * s);
        Height = Math.Max(Height, BaseHeight * s);
        SaveSettings();
    }

    private const double BaseWidth = 1040;
    private const double BaseHeight = 700;

    private void ApplyScale(double s)
    {
        if (s < 0.8 || s > 1.6) s = 1.0;
        UiScale.ScaleX = s;
        UiScale.ScaleY = s;
    }

    // ─── Размер окна (запоминаем разрешение и состояние) ───

    private void RestoreWindowSize()
    {
        if (_settings.WinMaximized)
        {
            WindowState = WindowState.Maximized;
        }
        else
        {
            if (_settings.WinW >= 400 && _settings.WinW <= 6000) Width = _settings.WinW;
            if (_settings.WinH >= 300 && _settings.WinH <= 4000) Height = _settings.WinH;
        }
    }

    private bool _sizeReady;

    private void SaveWindowSize()
    {
        // Игнорируем самые первые события до полной инициализации.
        if (!IsLoaded) { _sizeReady = true; return; }
        if (!_sizeReady) { _sizeReady = true; return; }

        _settings.WinMaximized = WindowState == WindowState.Maximized;
        // Размер сохраняем только в нормальном состоянии (RestoreBounds — на случай макс.).
        if (WindowState == WindowState.Normal)
        {
            _settings.WinW = Width;
            _settings.WinH = Height;
        }
        SaveSettings();
    }

    private void Restart()
    {
        try
        {
            string exe = Environment.ProcessPath ?? System.Diagnostics.Process.GetCurrentProcess().MainModule!.FileName;
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = exe,
                UseShellExecute = true,
            });
        }
        catch { }
        Application.Current.Shutdown();
    }

    // ─── Настройки / профили ───

    private AppSettings LoadSettings()
    {
        try
        {
            if (File.Exists(Paths.Settings))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(Paths.Settings)) ?? new AppSettings();
        }
        catch { }
        var s = new AppSettings();
        File.WriteAllText(Paths.Settings, JsonSerializer.Serialize(s, new JsonSerializerOptions { WriteIndented = true }));
        return s;
    }

    private void LoadLocalProfiles()
    {
        try
        {
            if (File.Exists(Paths.Profiles))
                _profiles = JsonSerializer.Deserialize<List<Profile>>(File.ReadAllText(Paths.Profiles)) ?? new();
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
                try { File.WriteAllText(Paths.Profiles, JsonSerializer.Serialize(pulled, new JsonSerializerOptions { WriteIndented = true })); } catch { }
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