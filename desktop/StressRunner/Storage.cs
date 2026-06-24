using Microsoft.Data.Sqlite;

namespace StressRunner;

/// <summary>
/// Локальная база результатов на компе (SQLite, файл stressrunner.db рядом с exe).
/// Хранит все прогоны даже если интернета нет — потом можно дослать.
/// </summary>
public class Storage
{
    private readonly string _connStr;

    public Storage(string dbPath)
    {
        _connStr = $"Data Source={dbPath}";
        Init();
    }

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_connStr);
        c.Open();
        return c;
    }

    private void Init()
    {
        using var c = Open();
        var cmd = c.CreateCommand();
        cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS runs (
    run_uid TEXT PRIMARY KEY,
    profile_name TEXT,
    machine_name TEXT,
    started_at TEXT,
    finished_at TEXT,
    total INTEGER,
    passed INTEGER,
    failed INTEGER,
    status TEXT,
    sent INTEGER DEFAULT 0,
    payload_json TEXT
);
CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_uid TEXT,
    test_name TEXT,
    command TEXT,
    exit_code INTEGER,
    duration_sec REAL,
    planned_sec INTEGER,
    timed_out INTEGER,
    success INTEGER,
    started_at TEXT,
    finished_at TEXT
);";
        cmd.ExecuteNonQuery();
    }

    /// <summary>Сохранить прогон в локальную БД (payload — полный JSON для отправки).</summary>
    public void SaveRun(RunPayload run, string payloadJson)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();

        var ins = c.CreateCommand();
        ins.CommandText = @"INSERT OR REPLACE INTO runs
            (run_uid, profile_name, machine_name, started_at, finished_at, total, passed, failed, status, sent, payload_json)
            VALUES ($u,$p,$m,$s,$f,$t,$pa,$fa,$st,0,$pj)";
        ins.Parameters.AddWithValue("$u", run.RunUid);
        ins.Parameters.AddWithValue("$p", run.ProfileName);
        ins.Parameters.AddWithValue("$m", run.MachineName);
        ins.Parameters.AddWithValue("$s", (object?)run.StartedAt ?? DBNull.Value);
        ins.Parameters.AddWithValue("$f", (object?)run.FinishedAt ?? DBNull.Value);
        ins.Parameters.AddWithValue("$t", run.Results.Count);
        ins.Parameters.AddWithValue("$pa", run.Results.Count(r => r.Success));
        ins.Parameters.AddWithValue("$fa", run.Results.Count(r => !r.Success));
        ins.Parameters.AddWithValue("$st", run.Status);
        ins.Parameters.AddWithValue("$pj", payloadJson);
        ins.ExecuteNonQuery();

        foreach (var r in run.Results)
        {
            var ir = c.CreateCommand();
            ir.CommandText = @"INSERT INTO results
                (run_uid, test_name, command, exit_code, duration_sec, planned_sec, timed_out, success, started_at, finished_at)
                VALUES ($u,$n,$c,$e,$d,$pl,$to,$su,$s,$f)";
            ir.Parameters.AddWithValue("$u", run.RunUid);
            ir.Parameters.AddWithValue("$n", r.TestName);
            ir.Parameters.AddWithValue("$c", r.Command);
            ir.Parameters.AddWithValue("$e", (object?)r.ExitCode ?? DBNull.Value);
            ir.Parameters.AddWithValue("$d", r.DurationSec);
            ir.Parameters.AddWithValue("$pl", r.PlannedSec);
            ir.Parameters.AddWithValue("$to", r.TimedOut ? 1 : 0);
            ir.Parameters.AddWithValue("$su", r.Success ? 1 : 0);
            ir.Parameters.AddWithValue("$s", (object?)r.StartedAt ?? DBNull.Value);
            ir.Parameters.AddWithValue("$f", (object?)r.FinishedAt ?? DBNull.Value);
            ir.ExecuteNonQuery();
        }

        tx.Commit();
    }

    public void MarkSent(string runUid)
    {
        using var c = Open();
        var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE runs SET sent = 1 WHERE run_uid = $u";
        cmd.Parameters.AddWithValue("$u", runUid);
        cmd.ExecuteNonQuery();
    }

    /// <summary>Прогоны, которые ещё не доставлены на сайт (для пересылки).</summary>
    public List<(string uid, string json)> GetUnsent()
    {
        var list = new List<(string, string)>();
        using var c = Open();
        var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT run_uid, payload_json FROM runs WHERE sent = 0 ORDER BY started_at";
        using var rd = cmd.ExecuteReader();
        while (rd.Read())
            list.Add((rd.GetString(0), rd.GetString(1)));
        return list;
    }
}
