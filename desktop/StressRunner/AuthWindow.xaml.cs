using System.IO;
using System.Text.Json;
using System.Windows;

namespace StressRunner;

/// <summary>
/// Окно авторизации: ввод секретного ключа + имени ПК.
/// «Авторизоваться» проверяет ключ на сайте, сохраняет в settings.json и
/// сообщает, что приложение перезапустится. Перезапуск делает вызывающая сторона.
/// </summary>
public partial class AuthWindow : Window
{
    private readonly AppSettings _settings;

    /// <summary>true, если авторизация прошла и настройки сохранены (нужен перезапуск).</summary>
    public bool Authorized { get; private set; }

    public AuthWindow(AppSettings settings)
    {
        InitializeComponent();
        _settings = settings;
        TokenBox.Password = _settings.Token ?? "";
        MachineBox.Text = string.IsNullOrWhiteSpace(_settings.MachineName)
            ? Environment.MachineName : _settings.MachineName;

        AuthBtn.Click += async (_, _) => await DoAuth();
        CancelBtn.Click += (_, _) => { DialogResult = false; Close(); };
    }

    private async System.Threading.Tasks.Task DoAuth()
    {
        string token = TokenBox.Password.Trim();
        string machine = MachineBox.Text.Trim();

        if (string.IsNullOrWhiteSpace(token))
        {
            SetStatus("Введи секретный ключ.", true);
            return;
        }

        AuthBtn.IsEnabled = false;
        SetStatus("Проверяю ключ на сайте...", false);

        bool ok = await Uploader.VerifyTokenAsync(_settings.IngestUrl, token);
        if (!ok)
        {
            SetStatus("Ключ не подошёл (или нет сети). Проверь STRESS_INGEST_TOKEN на сайте.", true);
            AuthBtn.IsEnabled = true;
            return;
        }

        // Сохраняем настройки.
        _settings.Token = token;
        _settings.MachineName = string.IsNullOrWhiteSpace(machine) ? Environment.MachineName : machine;
        try
        {
            Paths.EnsureDirs();
            File.WriteAllText(Paths.Settings,
                JsonSerializer.Serialize(_settings, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            SetStatus($"Не смог сохранить настройки: {ex.Message}", true);
            AuthBtn.IsEnabled = true;
            return;
        }

        SetStatus("Готово! Приложение сейчас перезапустится...", false);
        MessageBox.Show(this,
            $"Авторизация успешна.\nПК: {_settings.MachineName}\n\nПриложение перезапустится для применения настроек.",
            "Готово", MessageBoxButton.OK, MessageBoxImage.Information);

        Authorized = true;
        DialogResult = true;
        Close();
    }

    private void SetStatus(string text, bool error)
    {
        StatusText.Text = text;
        StatusText.Foreground = error
            ? (System.Windows.Media.Brush)FindResource("Primary")
            : (System.Windows.Media.Brush)FindResource("FgMuted");
    }
}
