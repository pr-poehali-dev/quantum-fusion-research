using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Text;

namespace StressRunner;

/// <summary>
/// Чтение сенсоров HWiNFO через Shared Memory (HWiNFO_SENS_SM2).
/// Это официальный канал HWiNFO: в общей памяти лежит заголовок + массив
/// «показаний» (readings), у каждого: тип, метка, значение/мин/макс/среднее
/// и единица измерения (°C, %, RPM, MHz, W). Юзер должен один раз включить
/// в HWiNFO «Shared Memory Support».
/// </summary>
public static class HwInfoSharedMem
{
    private const string MapName = "Global\\HWiNFO_SENS_SM2";
    private const string MapNameLocal = "HWiNFO_SENS_SM2"; // запасной (без Global)

    // Типы сенсоров HWiNFO (SENSOR_READING_TYPE).
    public enum ReadingType { None = 0, Temp = 1, Volt = 2, Fan = 3, Current = 4, Power = 5, Clock = 6, Usage = 7, Other = 8 }

    public class Reading
    {
        public ReadingType Type;
        public string Label = "";   // напр. "Total CPU Usage", "GPU Temperature"
        public string Unit = "";    // °C, %, RPM, MHz, W
        public double Value;
        public double Min;
        public double Max;
        public double Avg;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SharedMemHeader
    {
        public uint Signature;          // "HWiS" = 0x53695748
        public uint Version;
        public uint Revision;
        public long PollTime;
        public uint OffsetSensorSection;
        public uint SizeSensorElement;
        public uint NumSensorElements;
        public uint OffsetReadingSection;
        public uint SizeReadingElement;
        public uint NumReadingElements;
    }

    /// <summary>Прочитать все показания. Пусто — Shared Memory недоступна.</summary>
    public static List<Reading> ReadAll(out string status)
    {
        var list = new List<Reading>();
        MemoryMappedFile? mmf = TryOpen(out status);
        if (mmf == null) return list;

        try
        {
            using var acc = mmf.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
            acc.Read(0, out SharedMemHeader hdr);

            // Подпись "HWiS"
            if (hdr.Signature != 0x53695748)
            {
                status = "Shared Memory открыта, но подпись неверная (HWiNFO ещё не пишет данные?).";
                return list;
            }

            long readBase = hdr.OffsetReadingSection;
            int size = (int)hdr.SizeReadingElement;
            for (uint i = 0; i < hdr.NumReadingElements; i++)
            {
                long off = readBase + (long)i * size;
                var r = ParseReading(acc, off);
                if (r != null) list.Add(r);
            }

            status = $"Shared Memory OK: {list.Count} сенсоров.";
        }
        catch (Exception ex)
        {
            status = $"Ошибка чтения Shared Memory: {ex.Message}";
        }
        finally { mmf.Dispose(); }

        return list;
    }

    private static MemoryMappedFile? TryOpen(out string status)
    {
        try { status = ""; return MemoryMappedFile.OpenExisting(MapName, MemoryMappedFileRights.Read); }
        catch { }
        try { status = ""; return MemoryMappedFile.OpenExisting(MapNameLocal, MemoryMappedFileRights.Read); }
        catch { }
        status = "Shared Memory не найдена. Включи в HWiNFO «Shared Memory Support» (и оставь HWiNFO запущенным).";
        return null;
    }

    // Структура SENSOR_READING: тип(4) + ID(4) + Index(4) + LabelOrig(128) +
    // LabelUser(128) + Unit(16) + Value(8 double) + ValueMin(8) + ValueMax(8) + ValueAvg(8)
    private static Reading? ParseReading(MemoryMappedViewAccessor acc, long off)
    {
        try
        {
            uint type = acc.ReadUInt32(off + 0);
            // off+4 = ID, off+8 = Index — пропускаем
            string labelOrig = ReadAnsi(acc, off + 12, 128);
            string labelUser = ReadAnsi(acc, off + 12 + 128, 128);
            string unit = ReadAnsi(acc, off + 12 + 256, 16);
            long valOff = off + 12 + 256 + 16;
            double value = acc.ReadDouble(valOff);
            double vmin = acc.ReadDouble(valOff + 8);
            double vmax = acc.ReadDouble(valOff + 16);
            double vavg = acc.ReadDouble(valOff + 24);

            string label = !string.IsNullOrWhiteSpace(labelUser) ? labelUser : labelOrig;
            if (string.IsNullOrWhiteSpace(label)) return null;

            return new Reading
            {
                Type = type <= 8 ? (ReadingType)type : ReadingType.Other,
                Label = label, Unit = unit,
                Value = value, Min = vmin, Max = vmax, Avg = vavg,
            };
        }
        catch { return null; }
    }

    private static string ReadAnsi(MemoryMappedViewAccessor acc, long off, int len)
    {
        var buf = new byte[len];
        acc.ReadArray(off, buf, 0, len);
        int end = Array.IndexOf(buf, (byte)0);
        if (end < 0) end = len;
        return Encoding.Default.GetString(buf, 0, end).Trim();
    }
}
