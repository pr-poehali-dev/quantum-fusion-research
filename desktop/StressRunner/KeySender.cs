using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace StressRunner;

/// <summary>
/// Эмуляция нажатий клавиш в окно теста (напр. для FurMark: "P").
/// Надёжная активация окна через AttachThreadInput + поиск окна по заголовку,
/// и двойная отправка: глобально (keybd_event) и адресно в окно (PostMessage).
///
/// Формат строки клавиш: через запятую, напр. "V,F2,G,P,T".
/// </summary>
public static class KeySender
{
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] private static extern short VkKeyScan(char ch);
    [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint uCode, uint uMapType);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    private const int SW_RESTORE = 9;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_SCANCODE = 0x0008;
    private const uint WM_KEYDOWN = 0x0100;
    private const uint WM_KEYUP = 0x0101;

    public static void FocusAndSend(Process proc, string keys)
    {
        IntPtr h = WaitForWindow(proc);

        foreach (var token in keys.Split(new[] { ',', ' ' }, StringSplitOptions.RemoveEmptyEntries))
        {
            byte vk = ResolveVk(token.Trim());
            if (vk == 0) continue;

            ForceForeground(h);
            System.Threading.Thread.Sleep(250);

            // 1) Глобально (активному окну).
            PressScan(vk);
            // 2) Адресно в окно (на случай если фокус всё же не на нём).
            if (h != IntPtr.Zero)
            {
                PostMessage(h, WM_KEYDOWN, (IntPtr)vk, IntPtr.Zero);
                System.Threading.Thread.Sleep(40);
                PostMessage(h, WM_KEYUP, (IntPtr)vk, IntPtr.Zero);
            }
            System.Threading.Thread.Sleep(600);
        }
    }

    /// <summary>Жёстко перевести фокус на окно через AttachThreadInput.</summary>
    private static void ForceForeground(IntPtr h)
    {
        if (h == IntPtr.Zero) return;
        try
        {
            ShowWindow(h, SW_RESTORE);
            IntPtr fg = GetForegroundWindow();
            uint fgThread = GetWindowThreadProcessId(fg, out _);
            uint thisThread = GetCurrentThreadId();
            uint targetThread = GetWindowThreadProcessId(h, out _);

            AttachThreadInput(thisThread, fgThread, true);
            AttachThreadInput(thisThread, targetThread, true);

            BringWindowToTop(h);
            SetForegroundWindow(h);

            AttachThreadInput(thisThread, targetThread, false);
            AttachThreadInput(thisThread, fgThread, false);
        }
        catch { }
    }

    /// <summary>Ждём окно процесса; если MainWindowHandle пуст — ищем по заголовку.</summary>
    private static IntPtr WaitForWindow(Process proc)
    {
        for (int i = 0; i < 16; i++)
        {
            try { proc.Refresh(); if (proc.MainWindowHandle != IntPtr.Zero) return proc.MainWindowHandle; } catch { }

            // Поиск окна по заголовку (FurMark и т.п.) у того же PID.
            IntPtr byTitle = FindWindowByPid((uint)proc.Id);
            if (byTitle != IntPtr.Zero) return byTitle;

            System.Threading.Thread.Sleep(500);
        }
        return IntPtr.Zero;
    }

    private static IntPtr FindWindowByPid(uint pid)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, _) =>
        {
            if (!IsWindowVisible(h)) return true;
            GetWindowThreadProcessId(h, out uint wpid);
            if (wpid == pid)
            {
                var sb = new StringBuilder(256);
                GetWindowText(h, sb, sb.Capacity);
                if (sb.Length > 0) { found = h; return false; }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static void PressScan(byte vk)
    {
        byte scan = (byte)MapVirtualKey(vk, 0);
        keybd_event(vk, scan, KEYEVENTF_SCANCODE, UIntPtr.Zero);
        System.Threading.Thread.Sleep(50);
        keybd_event(vk, scan, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    private static byte ResolveVk(string token)
    {
        if (string.IsNullOrEmpty(token)) return 0;
        if ((token[0] == 'F' || token[0] == 'f') && token.Length > 1 &&
            int.TryParse(token[1..], out int fn) && fn >= 1 && fn <= 12)
            return (byte)(0x70 + (fn - 1));
        switch (token.ToUpperInvariant())
        {
            case "SPACE": return 0x20;
            case "ENTER": return 0x0D;
            case "ESC": return 0x1B;
            case "TAB": return 0x09;
        }
        short v = VkKeyScan(token[0]);
        return (byte)(v & 0xFF);
    }
}
