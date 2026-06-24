using System.Windows;

namespace StressRunner;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        // Нужно для чтения кириллицы (Windows-1251) из Shared Memory HWiNFO.
        System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);

        // Консольный режим: StressRunner.exe run "Имя профиля" (без окна).
        if (e.Args.Length >= 1 && e.Args[0].Equals("run", System.StringComparison.OrdinalIgnoreCase))
        {
            ConsoleMode.RunAsync(e.Args).GetAwaiter().GetResult();
            Shutdown();
            return;
        }

        base.OnStartup(e);
        var win = new MainWindow();
        win.Show();
    }
}