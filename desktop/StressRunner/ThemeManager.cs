using System.Windows;
using System.Windows.Media;

namespace StressRunner;

/// <summary>
/// Управление темой как на сайте: режим (тёмная/светлая) + акцентный цвет.
/// Цвета кладутся в Application.Resources как SolidColorBrush с ключами
/// Bg/Card/Muted/Border/Fg/FgMuted/Primary/Accent/Ok — на них ссылается XAML
/// через DynamicResource, поэтому смена темы перекрашивает окно на лету.
/// </summary>
public static class ThemeManager
{
    public record Accent(string Id, string Label, Color Primary, Color AccentCol);

    // Те же цвета, что в выборе темы на сайте.
    public static readonly Accent[] Accents =
    {
        new("red",    "Красный",    Hex("#E60000"), Hex("#F26B1F")),
        new("orange", "Оранжевый",  Hex("#F97316"), Hex("#FB923C")),
        new("blue",   "Синий",      Hex("#3B82F6"), Hex("#38BDF8")),
        new("purple", "Фиолетовый", Hex("#A855F7"), Hex("#C084FC")),
        new("green",  "Зелёный",    Hex("#22C55E"), Hex("#4ADE80")),
        new("cyan",   "Бирюзовый",  Hex("#06B6D4"), Hex("#22D3EE")),
    };

    public static void Apply(string mode, string accentId)
    {
        bool dark = mode != "light";
        var acc = Find(accentId);

        // База (фон/карточки/текст) — для тёмной и светлой темы.
        if (dark)
        {
            Set("Bg",       Hex("#0A0A0A"));
            Set("Card",     Hex("#121212"));
            Set("Muted",    Hex("#1A1A1A"));
            Set("Border",   Hex("#1F1F1F"));
            Set("Fg",       Hex("#F2F2F2"));
            Set("FgMuted",  Hex("#737373"));
        }
        else
        {
            Set("Bg",       Hex("#FFFFFF"));
            Set("Card",     Hex("#F5F5F5"));
            Set("Muted",    Hex("#ECECEC"));
            Set("Border",   Hex("#E0E0E0"));
            Set("Fg",       Hex("#171717"));
            Set("FgMuted",  Hex("#8A8A8A"));
        }

        Set("Primary", acc.Primary);
        Set("Accent",  acc.AccentCol);
        Set("Ok",      Hex("#22C55E"));
    }

    public static Accent Find(string id)
    {
        foreach (var a in Accents) if (a.Id == id) return a;
        return Accents[0];
    }

    private static void Set(string key, Color c)
    {
        var res = Application.Current.Resources;
        if (res[key] is SolidColorBrush b && !b.IsFrozen)
            b.Color = c;
        else
            res[key] = new SolidColorBrush(c);
    }

    private static Color Hex(string hex)
        => (Color)ColorConverter.ConvertFromString(hex)!;
}
