using System.Text;
using System.Windows;

namespace StressRunner;

/// <summary>
/// Окно отладки датчиков: показывает, какой канал HWiNFO доступен (Shared
/// Memory / реестр / ничего) и полный список сенсоров с типом/значением.
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
        var (status, readings) = HwInfoReader.Debug();
        StatusText.Text = status;

        _rows = new List<object>();
        foreach (var r in readings)
        {
            _rows.Add(new
            {
                Type = r.Type.ToString(),
                r.Label,
                Value = r.Value.ToString("0.0"),
                Min = r.Min.ToString("0.0"),
                Max = r.Max.ToString("0.0"),
                r.Unit,
            });
        }
        Grid.ItemsSource = _rows;
    }

    private void Copy()
    {
        var sb = new StringBuilder();
        var (status, readings) = HwInfoReader.Debug();
        sb.AppendLine(status);
        foreach (var r in readings)
            sb.AppendLine($"[{r.Type}] {r.Label} = {r.Value:0.0} {r.Unit} (min {r.Min:0.0}, max {r.Max:0.0})");
        try { Clipboard.SetText(sb.ToString()); MessageBox.Show(this, "Скопировано в буфер обмена."); } catch { }
    }
}
