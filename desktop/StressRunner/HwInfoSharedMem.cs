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
                var r = ParseReading(acc, off, size);
                if (r != null) list.Add(r);
            }

            status = $"Shared Memory OK: {list.Count} сенсоров (размер элемента {size} б).";
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

    // Структура HWiNFO_SENSORS_READING_ELEMENT:
    //   tReading(4) + dwSensorIndex(4) + dwReadingID(4)
    //   + szLabelOrig[128] + szLabelUser[128] + szUnit[16]
    //   + Value(double) + ValueMin(double) + ValueMax(double) + ValueAvg(double)
    // ВАЖНО: из-за выравнивания double-блок (32 байта) находится В САМОМ КОНЦЕ
    // элемента. Поэтому читаем его по фактическому размеру элемента (sizeElem)
    // из заголовка, а не по ручному смещению — это убирает сдвиг/мусор.
    private static Reading? ParseReading(MemoryMappedViewAccessor acc, long off, int sizeElem)
    {
        try
        {
            uint type = acc.ReadUInt32(off + 0);
            string labelOrig = ReadStr(acc, off + 12, 128);
            string labelUser = ReadStr(acc, off + 12 + 128, 128);
            string unit = ReadStr(acc, off + 12 + 256, 16);

            // 4 double в конце элемента.
            long dblOff = off + sizeElem - 32;
            double value = acc.ReadDouble(dblOff);
            double vmin = acc.ReadDouble(dblOff + 8);
            double vmax = acc.ReadDouble(dblOff + 16);
            double vavg = acc.ReadDouble(dblOff + 24);

            string label = !string.IsNullOrWhiteSpace(labelUser) ? labelUser : labelOrig;
            if (string.IsNullOrWhiteSpace(label)) return null;

            // Фильтр мусора: запредельные/NaN значения отбрасываем.
            if (!IsSane(value)) value = 0;
            if (!IsSane(vmin)) vmin = value;
            if (!IsSane(vmax)) vmax = value;
            if (!IsSane(vavg)) vavg = value;

            return new Reading
            {
                Type = type <= 8 ? (ReadingType)type : ReadingType.Other,
                Label = label, Unit = unit,
                Value = value, Min = vmin, Max = vmax, Avg = vavg,
            };
        }
        catch { return null; }
    }

    private static bool IsSane(double v)
        => !double.IsNaN(v) && !double.IsInfinity(v) && Math.Abs(v) < 1e9;

    // HWiNFO пишет строки в кодировке Windows-1251 (кириллица) либо ANSI.
    // Пробуем 1251, если не вышло — системную.
    private static string ReadStr(MemoryMappedViewAccessor acc, long off, int len)
    {
        var buf = new byte[len];
        acc.ReadArray(off, buf, 0, len);
        int end = Array.IndexOf(buf, (byte)0);
        if (end < 0) end = len;
        if (end == 0) return "";
        try
        {
            return Encoding.GetEncoding(1251).GetString(buf, 0, end).Trim();
        }
        catch
        {
            return Encoding.Default.GetString(buf, 0, end).Trim();
        }
    }
}