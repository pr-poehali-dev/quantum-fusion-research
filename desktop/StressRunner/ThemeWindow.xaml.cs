using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace StressRunner;

/// <summary>
/// Окно выбора темы: режим (тёмная/светлая) + акцентный цвет.
/// Изменения применяются мгновенно и через колбэк сохраняются в settings.
/// </summary>
public partial class ThemeWindow : Window
{
    private readonly AppSettings _settings;
    private readonly Action _onChanged;

    public ThemeWindow(AppSettings settings, Action onChanged)
    {
        InitializeComponent();
        _settings = settings;
        _onChanged = onChanged;

        DarkBtn.Click += (_, _) => SetMode("dark");
        LightBtn.Click += (_, _) => SetMode("light");

        BuildAccents();
        RefreshModeButtons();
    }

    private void SetMode(string mode)
    {
        _settings.ThemeMode = mode;
        ThemeManager.Apply(_settings.ThemeMode, _settings.Accent);
        RefreshModeButtons();
        _onChanged();
    }

    private void RefreshModeButtons()
    {
        bool dark = _settings.ThemeMode != "light";
        var primary = (Brush)FindResource("Primary");
        var muted = (Brush)FindResource("Muted");
        DarkBtn.Background = dark ? primary : muted;
        DarkBtn.Foreground = dark ? Brushes.White : (Brush)FindResource("Fg");
        LightBtn.Background = !dark ? primary : muted;
        LightBtn.Foreground = !dark ? Brushes.White : (Brush)FindResource("Fg");
    }

    private void BuildAccents()
    {
        AccentList.Children.Clear();
        foreach (var acc in ThemeManager.Accents)
        {
            bool active = acc.Id == _settings.Accent;
            var row = new Border
            {
                CornerRadius = new CornerRadius(10),
                BorderThickness = new Thickness(1),
                BorderBrush = active ? (Brush)FindResource("Primary") : (Brush)FindResource("Border"),
                Background = active ? new SolidColorBrush(WithAlpha(acc.Primary, 28)) : Brushes.Transparent,
                Padding = new Thickness(12, 9, 12, 9),
                Margin = new Thickness(0, 0, 0, 6),
                Cursor = System.Windows.Input.Cursors.Hand,
            };
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var dot = new Border
            {
                Width = 18, Height = 18, CornerRadius = new CornerRadius(9),
                Background = new SolidColorBrush(acc.Primary),
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(dot, 0);

            var label = new TextBlock
            {
                Text = acc.Label, FontSize = 13, Margin = new Thickness(11, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("Fg"),
            };
            Grid.SetColumn(label, 1);

            grid.Children.Add(dot);
            grid.Children.Add(label);

            if (active)
            {
                var check = new TextBlock
                {
                    Text = "✓", FontSize = 14, FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("Primary"),
                    VerticalAlignment = VerticalAlignment.Center,
                };
                Grid.SetColumn(check, 2);
                grid.Children.Add(check);
            }

            row.Child = grid;
            string id = acc.Id;
            row.MouseLeftButtonUp += (_, _) =>
            {
                _settings.Accent = id;
                ThemeManager.Apply(_settings.ThemeMode, _settings.Accent);
                BuildAccents();
                RefreshModeButtons();
                _onChanged();
            };
            AccentList.Children.Add(row);
        }
    }

    private static Color WithAlpha(Color c, byte a) => Color.FromArgb(a, c.R, c.G, c.B);
}
