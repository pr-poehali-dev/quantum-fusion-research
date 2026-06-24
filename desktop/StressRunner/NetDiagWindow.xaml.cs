using System.Windows;
using System.Windows.Media;

namespace StressRunner;

/// <summary>Окно сетевой диагностики: гоняет NetDiag и показывает отчёт.</summary>
public partial class NetDiagWindow : Window
{
    private readonly AppSettings _settings;
    private string _lastReport = "";

    public NetDiagWindow(AppSettings settings)
    {
        InitializeComponent();
        _settings = settings;
        RetryBtn.Click += async (_, _) => await Run();
        CopyBtn.Click += (_, _) =>
        {
            try { Clipboard.SetText(_lastReport); MessageBox.Show(this, "Отчёт скопирован."); } catch { }
        };
        Loaded += async (_, _) => await Run();
    }

    private async System.Threading.Tasks.Task Run()
    {
        RetryBtn.IsEnabled = false;
        Title2.Text = "Проверка подключения к сайту…";
        StatusDot.Foreground = (Brush)FindResource("Accent");
        LogBox.Text = "Выполняю проверки…";

        var res = await NetDiag.RunAsync(_settings);
        _lastReport = res.Log.ToString();
        LogBox.Text = _lastReport;
        Scroll.ScrollToEnd();

        StatusDot.Foreground = (Brush)FindResource(res.Ok ? "Ok" : "Primary");
        Title2.Text = res.Ok ? "Подключение работает" : "Есть проблема с подключением";
        RetryBtn.IsEnabled = true;
    }
}
