using System.Diagnostics;
using System.Runtime.InteropServices;

namespace StressRunner;

/// <summary>
/// Эмуляция нажатий клавиш в окно теста (напр. "P" для FurMark — размазывает
/// бублик и повышает нагрузку на GPU). Активируем окно процесса и шлём клавиши
/// через keybd_event.
/// </summary>
public static class KeySender
{
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    [DllImport("user32.dll")]
    private static extern short VkKeyScan(char ch);

    private const int SW_RESTORE = 9;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    public static void FocusAndSend(Process proc, string keys)
    {
        try { proc.Refresh(); } catch { }
        IntPtr h = proc.MainWindowHandle;
        if (h == IntPtr.Zero)
        {
            // Окно ещё не появилось — подождём чуть-чуть.
            for (int i = 0; i < 10 && h == IntPtr.Zero; i++)
            {
                System.Threading.Thread.Sleep(500);
                try { proc.Refresh(); h = proc.MainWindowHandle; } catch { }
            }
        }
        if (h != IntPtr.Zero)
        {
            ShowWindow(h, SW_RESTORE);
            SetForegroundWindow(h);
            System.Threading.Thread.Sleep(300);
        }

        foreach (char c in keys)
        {
            if (c == ' ' || c == ',') continue;
            short vk = VkKeyScan(c);
            byte key = (byte)(vk & 0xFF);
            keybd_event(key, 0, 0, UIntPtr.Zero);
            System.Threading.Thread.Sleep(40);
            keybd_event(key, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            System.Threading.Thread.Sleep(120);
        }
    }
}
