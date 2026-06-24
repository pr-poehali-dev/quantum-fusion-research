using System.IO;

namespace StressRunner;

/// <summary>
/// Все пути приложения. Портативная схема:
///
///   StressRunner\
///   ├── StressRunner.exe        ← корень (Root)
///   ├── Data\                   ← settings.json, profiles.json, БД, логи
///   └── StressTests\            ← сюда кладут утилиты (OCCT, FurMark, ...)
///
/// Папки Data и StressTests создаются автоматически при первом запуске.
/// Относительные пути в профилях (напр. "StressTests\OCCT\OCCT.exe")
/// разворачиваются от корня — поэтому всё переносится на флешке как есть.
/// </summary>
public static class Paths
{
    /// <summary>Папка, где лежит StressRunner.exe.</summary>
    public static string Root => AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);

    public static string DataDir => Path.Combine(Root, "Data");
    public static string TestsDir => Path.Combine(Root, "StressTests");

    public static string Settings => Path.Combine(DataDir, "settings.json");
    public static string Profiles => Path.Combine(DataDir, "profiles.json");
    public static string Db => Path.Combine(DataDir, "stressrunner.db");

    /// <summary>Создать папки Data и StressTests, если их ещё нет.</summary>
    public static void EnsureDirs()
    {
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(TestsDir);
    }

    /// <summary>
    /// Превратить путь из профиля в абсолютный.
    /// - переменные окружения (%USERPROFILE%) разворачиваются;
    /// - абсолютный путь (C:\..., \\server\...) остаётся как есть;
    /// - относительный путь считается от корня StressRunner (Root).
    /// Так "StressTests\OCCT\OCCT.exe" работает на любом ПК.
    /// </summary>
    public static string Resolve(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return raw;
        string p = Environment.ExpandEnvironmentVariables(raw.Trim());
        if (Path.IsPathRooted(p)) return p;
        return Path.GetFullPath(Path.Combine(Root, p));
    }
}
