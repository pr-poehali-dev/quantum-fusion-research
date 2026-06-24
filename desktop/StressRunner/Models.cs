using System.Text.Json.Serialization;

namespace StressRunner;

/// <summary>
/// Один тест в списке: что запускать, с какими аргументами и на сколько времени.
/// </summary>
public class TestItem
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    /// <summary>Путь к программе (.exe) или к скрипту (.bat/.cmd/.ps1).</summary>
    [JsonPropertyName("program")]
    public string Program { get; set; } = "";

    /// <summary>Аргументы командной строки.</summary>
    [JsonPropertyName("args")]
    public string Args { get; set; } = "";

    /// <summary>Рабочая папка (откуда запускать). Пусто — папка программы.</summary>
    [JsonPropertyName("working_dir")]
    public string WorkingDir { get; set; } = "";

    /// <summary>Сколько секунд держать тест. По истечении процесс будет остановлен.</summary>
    [JsonPropertyName("duration_sec")]
    public int DurationSec { get; set; } = 60;

    /// <summary>
    /// Считать ли таймаут успехом. Для стресс-утилит (OCCT, Prime95), которые
    /// «крутятся» бесконечно, остановка по времени = успех. true по умолчанию.
    /// </summary>
    [JsonPropertyName("timeout_is_success")]
    public bool TimeoutIsSuccess { get; set; } = true;

    /// <summary>
    /// Какой exit code считать успехом, если тест завершился сам.
    /// 0 по умолчанию. -1 — любой код считать успехом.
    /// </summary>
    [JsonPropertyName("success_exit_code")]
    public int SuccessExitCode { get; set; } = 0;

    /// <summary>
    /// Файлы-отчёты, которые программа оставляет после себя. Их заберём и пошлём
    /// на сайт. Поддерживаются маски (*.log, report_*.txt).
    /// </summary>
    [JsonPropertyName("report_files")]
    public List<string> ReportFiles { get; set; } = new();

    /// <summary>
    /// Минимум секунд работы. Если процесс завершился раньше — тест провален
    /// (защита от GUI-программ типа OCCT, которые «открыли окно и вышли»).
    /// 0 — проверка выключена.
    /// </summary>
    [JsonPropertyName("min_run_sec")]
    public int MinRunSec { get; set; } = 0;

    /// <summary>
    /// Клавиши, которые нажать через несколько секунд после запуска
    /// (эмуляция в активное окно теста). Напр. "P" для FurMark — размазывает
    /// бублик и повышает нагрузку на GPU. Пусто — ничего не нажимаем.
    /// </summary>
    [JsonPropertyName("send_keys")]
    public string SendKeys { get; set; } = "";

    /// <summary>Через сколько секунд после запуска нажать SendKeys. По умолчанию 5.</summary>
    [JsonPropertyName("send_keys_delay_sec")]
    public int SendKeysDelaySec { get; set; } = 5;
}

/// <summary>
/// Профиль = именованный набор тестов. Профили сохраняются в profiles.json.
/// </summary>
public class Profile
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("note")]
    public string Note { get; set; } = "";

    [JsonPropertyName("tests")]
    public List<TestItem> Tests { get; set; } = new();
}

/// <summary>Файл настроек приложения (settings.json).</summary>
public class AppSettings
{
    /// <summary>URL функции stress на сайте (action=ingest добавляется автоматически).</summary>
    [JsonPropertyName("ingest_url")]
    public string IngestUrl { get; set; } = "https://functions.poehali.dev/ffa7efcd-7a92-4a76-a463-abec515d846c";

    /// <summary>Секретный токен (секрет STRESS_INGEST_TOKEN на сайте).</summary>
    [JsonPropertyName("token")]
    public string Token { get; set; } = "";

    /// <summary>Имя этого ПК (для отображения в админке). Пусто — возьмём имя машины.</summary>
    [JsonPropertyName("machine_name")]
    public string MachineName { get; set; } = "";

    /// <summary>Слать ли файлы-отчёты на сайт.</summary>
    [JsonPropertyName("upload_files")]
    public bool UploadFiles { get; set; } = true;

    /// <summary>Максимальный размер одного файла-отчёта для отправки, МБ.</summary>
    [JsonPropertyName("max_file_mb")]
    public int MaxFileMb { get; set; } = 8;

    /// <summary>Тема оформления: "dark" или "light".</summary>
    [JsonPropertyName("theme_mode")]
    public string ThemeMode { get; set; } = "dark";

    /// <summary>Акцентный цвет: red/orange/blue/purple/green/cyan.</summary>
    [JsonPropertyName("accent")]
    public string Accent { get; set; } = "red";

    /// <summary>Путь к HWiNFO64.exe (относительный или полный). Пусто — авто-поиск в StressTests\HWinfo.</summary>
    [JsonPropertyName("hwinfo_path")]
    public string HwInfoPath { get; set; } = "";
}

// ─── Модели для отправки на сайт (JSON совпадает с backend/stress) ───

public class ResultPayload
{
    [JsonPropertyName("test_name")] public string TestName { get; set; } = "";
    [JsonPropertyName("command")] public string Command { get; set; } = "";
    [JsonPropertyName("exit_code")] public int? ExitCode { get; set; }
    [JsonPropertyName("duration_sec")] public double DurationSec { get; set; }
    [JsonPropertyName("planned_sec")] public int PlannedSec { get; set; }
    [JsonPropertyName("timed_out")] public bool TimedOut { get; set; }
    [JsonPropertyName("success")] public bool Success { get; set; }
    [JsonPropertyName("started_at")] public string? StartedAt { get; set; }
    [JsonPropertyName("finished_at")] public string? FinishedAt { get; set; }
    [JsonPropertyName("files")] public List<FilePayload> Files { get; set; } = new();
}

public class FilePayload
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("content_base64")] public string ContentBase64 { get; set; } = "";
}

/// <summary>Агрегированная метрика за прогон: min/max/avg по одной величине.</summary>
public class MetricPayload
{
    [JsonPropertyName("key")] public string Key { get; set; } = "";       // cpu_temp, gpu_temp, cpu_load, gpu_load, fan, clock, power
    [JsonPropertyName("label")] public string Label { get; set; } = "";   // человекочитаемое
    [JsonPropertyName("unit")] public string Unit { get; set; } = "";     // °C, %, RPM, MHz, W
    [JsonPropertyName("min")] public double Min { get; set; }
    [JsonPropertyName("max")] public double Max { get; set; }
    [JsonPropertyName("avg")] public double Avg { get; set; }
    [JsonPropertyName("samples")] public int Samples { get; set; }
}

public class RunPayload
{
    [JsonPropertyName("run_uid")] public string RunUid { get; set; } = "";
    [JsonPropertyName("profile_name")] public string ProfileName { get; set; } = "";
    [JsonPropertyName("machine_name")] public string MachineName { get; set; } = "";
    [JsonPropertyName("os_info")] public string OsInfo { get; set; } = "";
    [JsonPropertyName("note")] public string Note { get; set; } = "";
    [JsonPropertyName("started_at")] public string? StartedAt { get; set; }
    [JsonPropertyName("finished_at")] public string? FinishedAt { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "completed";
    [JsonPropertyName("results")] public List<ResultPayload> Results { get; set; } = new();
    [JsonPropertyName("metrics")] public List<MetricPayload> Metrics { get; set; } = new();
}