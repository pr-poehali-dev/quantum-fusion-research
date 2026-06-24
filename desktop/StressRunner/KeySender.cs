using System.Diagnostics;
using System.Runtime.InteropServices;

namespace StressRunner;

/// <summary>
/// Эмуляция нажатий клавиш в окно теста (напр. для FurMark: V, F2, G, P, T).
/// Перед каждым нажатием форсируем фокус на окно процесса.
///
/// Формат строки клавиш: через запятую, напр. "V,F2,G,P,T".
/// Поддержка одиночных букв/цифр и функциональных клавиш F1..F12.
/// </summary>
public static class KeySender
{
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    [DllImport("user32.dll")]
    private static extern short VkKeyScan(char ch);

    [DllImport("user32.dll")]
    private static extern uint MapVirtualKey(uint uCode, uint uMapType);

    private const int SW_RESTORE = 9;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_SCANCODE = 0x0008;

    public static void FocusAndSend(Process proc, string keys)
    {
        IntPtr h = WaitForWindow(proc);

        foreach (var token in keys.Split(new[] { ',', ' ' }, StringSplitOptions.RemoveEmptyEntries))
        {
            byte vk = ResolveVk(token.Trim());
            if (vk == 0) continue;

            // Каждый раз форсим фокус — FurMark в полноэкране может терять его.
            if (h != IntPtr.Zero)
            {
                ShowWindow(h, SW_RESTORE);
                BringWindowToTop(h);
                SetForegroundWindow(h);
                System.Threading.Thread.Sleep(400);
            }

            PressScan(vk);
            System.Threading.Thread.Sleep(600);
        }
    }

    private static IntPtr WaitForWindow(Process proc)
    {
        IntPtr h = IntPtr.Zero;
        for (int i = 0; i < 12; i++)
        {
            try { proc.Refresh(); h = proc.MainWindowHandle; } catch { }
            if (h != IntPtr.Zero) break;
            System.Threading.Thread.Sleep(500);
        }
        return h;
    }

    /// <summary>Нажатие через scan-code — надёжнее для игровых/OpenGL окон.</summary>
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

        // Функциональные клавиши F1..F12
        if ((token[0] == 'F' || token[0] == 'f') && token.Length > 1 &&
            int.TryParse(token[1..], out int fn) && fn >= 1 && fn <= 12)
            return (byte)(0x70 + (fn - 1)); // VK_F1 = 0x70

        // Спец-имена
        switch (token.ToUpperInvariant())
        {
            case "SPACE": return 0x20;
            case "ENTER": return 0x0D;
            case "ESC": return 0x1B;
            case "TAB": return 0x09;
        }

        // Обычная буква/цифра
        short v = VkKeyScan(token[0]);
        return (byte)(v & 0xFF);
    }
}
