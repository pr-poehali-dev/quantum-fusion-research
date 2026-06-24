using System.Text;
using System.Windows;

namespace StressRunner;

/// <summary>
/// Окно отладки датчиков: статус источника (LibreHardwareMonitor) и полный
/// список датчиков с железом/типом/значением.
/// </summary>
public partial class DebugWindow : Window
{
    public DebugWindow()
    {
        InitializeComponent();
        RefreshBtn.Click += (_, _) => Load();
        CopyBtn.Click += (_, _) => Copy();
        Load();
    }

    private List<object> _rows = new();

    private void Load()
    {
        var (status, sensors) = HwInfoReader.Debug();
        StatusText.Text = status;

        _rows = new List<object>();
        foreach (var s in sensors)
        {
            _rows.Add(new
            {
                s.Type,
                Label = $"{s.Hardware} · {s.Name}",
                Value = s.Value.ToString("0.0"),
                Min = "",
                Max = "",
                s.Unit,
            });
        }
        Grid.ItemsSource = _rows;
    }

    private void Copy()
    {
        var sb = new StringBuilder();
        var (status, sensors) = HwInfoReader.Debug();
        sb.AppendLine(status);
        foreach (var s in sensors)
            sb.AppendLine($"[{s.Type}] {s.Hardware} · {s.Name} = {s.Value:0.0} {s.Unit}");
        try { Clipboard.SetText(sb.ToString()); MessageBox.Show(this, "Скопировано в буфер обмена."); } catch { }
    }
}
