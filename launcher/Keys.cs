// Small helper for the in-game overlay.
//   keys.exe focus <hwnd>          bring a window to the front (Windows normally blocks this
//                                  for programs in the background)
//   keys.exe confirm <pid> [secs]  press Yes/OK in that program's own "confirm shutdown/exit" dialog
//                                  (secs: keep looking that long, until it shows or the program is gone)
//   keys.exe send <pid> <combo>    bring the game's window (pid or its child) to the front and
//                                  press a key combo, e.g. "F1", "Shift+F1", "Ctrl+P"
//   keys.exe unmark <hwnd>          take the taskbar's "full screen" mark off a window (Chromium sets it; Windows 11's
//                                  Alt+Tab then lists MediaDeck twice after quick switches)
//   keys.exe freeze <pid> / thaw <pid>  stop / continue the program (all its threads) - an emulator stands still
//                                  while MediaDeck's menu is open, so the controller doesn't play the game too
// Keys are sent as hardware scan codes, which emulators (DirectInput / raw input) understand.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("602D4995-B13A-429b-A66E-1935E44F4317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ITaskbarList2
{
    void HrInit(); void AddTab(IntPtr h); void DeleteTab(IntPtr h); void ActivateTab(IntPtr h); void SetActiveAlt(IntPtr h);
    void MarkFullscreenWindow(IntPtr h, [MarshalAs(UnmanagedType.Bool)] bool full);
}
[ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")] class TaskbarList { }

static class Keys
{
    [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr p);
    [DllImport("ntdll.dll")] static extern int NtResumeProcess(IntPtr p);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    delegate bool EnumProc(IntPtr h, IntPtr p);

    const uint KEYUP = 0x2, SCANCODE = 0x8, EXTENDED = 0x1;

    // Windows lets a program take the foreground right after a key event: tap Alt first
    static void Focus(IntPtr h)
    {
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, KEYUP, UIntPtr.Zero);
        if (IsIconic(h)) ShowWindow(h, 9);
        SetForegroundWindow(h);
    }

    // The biggest visible top window of a process or one of its children (the game screen,
    // not a small tool window)
    static IntPtr WindowOf(int pid)
    {
        var pids = new HashSet<uint> { (uint)pid };
        try
        {
            using (var s = new System.Management.ManagementObjectSearcher("SELECT ProcessId FROM Win32_Process WHERE ParentProcessId=" + pid))
                foreach (var o in s.Get()) pids.Add((uint)o["ProcessId"]);
        }
        catch { }
        IntPtr found = IntPtr.Zero; long best = -1;
        EnumWindows((h, p) =>
        {
            uint wp; GetWindowThreadProcessId(h, out wp);
            RECT r;
            if (pids.Contains(wp) && IsWindowVisible(h) && GetWindowRect(h, out r))
            {
                long area = (long)(r.R - r.L) * (r.B - r.T);
                if (area > best) { best = area; found = h; }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // Emulators like PCSX2 ask "Are you sure you want to shut down?" on close. Press Yes/OK,
    // but only in a dialog of that program whose title is about closing.
    static bool Confirm(int pid)
    {
        var titles = new System.Text.RegularExpressions.Regex("confirm|shut ?down|exit|quit|close|stop", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var root = System.Windows.Automation.AutomationElement.RootElement;
        var mine = new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.ProcessIdProperty, pid);
        // only that program's own windows (searching the whole desktop takes seconds): its top-level windows and
        // the windows inside them (DuckStation's "Confirm Exit" sits in its main window)
        var windows = new List<System.Windows.Automation.AutomationElement>();
        var isWindow = new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.ControlTypeProperty, System.Windows.Automation.ControlType.Window);
        foreach (System.Windows.Automation.AutomationElement top in root.FindAll(System.Windows.Automation.TreeScope.Children, mine))
        {
            windows.Add(top);
            foreach (System.Windows.Automation.AutomationElement inner in top.FindAll(System.Windows.Automation.TreeScope.Descendants, isWindow)) windows.Add(inner);
        }
        foreach (var w in windows)
        {
            if (w.Current.ControlType != System.Windows.Automation.ControlType.Window) continue;
            // The dialog is about closing: by its title, or by its text ("Are you sure you want to exit?")
            bool aboutClosing = titles.IsMatch(w.Current.Name ?? "");
            if (!aboutClosing)
                foreach (System.Windows.Automation.AutomationElement x in w.FindAll(System.Windows.Automation.TreeScope.Descendants, new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.ControlTypeProperty, System.Windows.Automation.ControlType.Text)))
                    if (System.Text.RegularExpressions.Regex.IsMatch(x.Current.Name ?? "", "(?i)\\b(exit|quit|shut ?down|close|stop)\\b.*\\?|\\bsure\\b.*\\b(exit|quit|shut ?down|close|stop)\\b")) { aboutClosing = true; break; }
            if (!aboutClosing) continue;
            foreach (System.Windows.Automation.AutomationElement b in w.FindAll(System.Windows.Automation.TreeScope.Descendants, System.Windows.Automation.Condition.TrueCondition))
            {
                var n = (b.Current.Name ?? "").Replace("&", "").Trim();
                if (b.Current.ControlType != System.Windows.Automation.ControlType.Button) continue;
                if (!n.Equals("Yes", StringComparison.OrdinalIgnoreCase) && !n.Equals("OK", StringComparison.OrdinalIgnoreCase)) continue;
                object pat;
                if (b.TryGetCurrentPattern(System.Windows.Automation.InvokePattern.Pattern, out pat))
                { ((System.Windows.Automation.InvokePattern)pat).Invoke(); return true; }
            }
        }
        return false;
    }

    static readonly Dictionary<string, byte> Named = new Dictionary<string, byte>(StringComparer.OrdinalIgnoreCase)
    {
        { "space", 0x20 }, { "enter", 0x0D }, { "return", 0x0D }, { "escape", 0x1B }, { "esc", 0x1B }, { "tab", 0x09 },
        { "backspace", 0x08 }, { "pause", 0x13 }, { "insert", 0x2D }, { "delete", 0x2E }, { "home", 0x24 }, { "end", 0x23 },
        { "pageup", 0x21 }, { "pagedown", 0x22 }, { "up", 0x26 }, { "down", 0x28 }, { "left", 0x25 }, { "right", 0x27 },
        { "shift", 0x10 }, { "ctrl", 0x11 }, { "control", 0x11 }, { "alt", 0x12 },
    };
    static readonly HashSet<byte> Extended = new HashSet<byte> { 0x2D, 0x2E, 0x24, 0x23, 0x21, 0x22, 0x26, 0x28, 0x25, 0x27 };

    static byte Vk(string k)
    {
        byte v;
        if (Named.TryGetValue(k, out v)) return v;
        if (k.Length > 1 && (k[0] == 'F' || k[0] == 'f')) { int n; if (int.TryParse(k.Substring(1), out n) && n >= 1 && n <= 24) return (byte)(0x6F + n); }
        if (k.Length == 1) return (byte)char.ToUpperInvariant(k[0]);
        throw new ArgumentException("unknown key " + k);
    }

    static void Key(byte vk, bool up)
    {
        byte scan = (byte)MapVirtualKey(vk, 0);
        uint f = SCANCODE | (up ? KEYUP : 0) | (Extended.Contains(vk) ? EXTENDED : 0);
        keybd_event(vk, scan, f, UIntPtr.Zero);
    }

    static void SendCombo(string combo)
    {
        var parts = combo.Split('+');
        var vks = new List<byte>();
        foreach (var p in parts) vks.Add(Vk(p.Trim()));
        foreach (var v in vks) { Key(v, false); Thread.Sleep(25); }
        Thread.Sleep(60);
        for (int i = vks.Count - 1; i >= 0; i--) { Key(vks[i], true); Thread.Sleep(25); }
    }

    static int Main(string[] a)
    {
        try
        {
            if (a.Length >= 2 && a[0] == "unmark")
            {
                var tb = (ITaskbarList2)new TaskbarList();
                tb.HrInit();
                tb.MarkFullscreenWindow(new IntPtr(long.Parse(a[1])), false);
                return 0;
            }
            if (a.Length >= 2 && (a[0] == "freeze" || a[0] == "thaw"))
            {
                var p = OpenProcess(0x0800, false, int.Parse(a[1]));   // PROCESS_SUSPEND_RESUME
                if (p == IntPtr.Zero) return 2;
                int r = a[0] == "freeze" ? NtSuspendProcess(p) : NtResumeProcess(p);
                CloseHandle(p);
                return r == 0 ? 0 : 3;
            }
            if (a.Length >= 2 && a[0] == "focus") { Focus(new IntPtr(long.Parse(a[1]))); return 0; }
            if (a.Length >= 2 && a[0] == "game") { var h = WindowOf(int.Parse(a[1])); if (h == IntPtr.Zero) return 2; Focus(h); return 0; }
            if (a.Length >= 2 && a[0] == "confirm")
            {
                int pid = int.Parse(a[1]);
                var until = DateTime.Now.AddSeconds(a.Length >= 3 ? double.Parse(a[2], System.Globalization.CultureInfo.InvariantCulture) : 0);
                do
                {
                    if (Confirm(pid)) return 0;
                    try { if (Process.GetProcessById(pid).HasExited) return 4; } catch (ArgumentException) { return 4; }   // gone
                    Thread.Sleep(150);
                } while (DateTime.Now < until);
                return 3;
            }
            if (a.Length >= 3 && a[0] == "send")
            {
                var h = WindowOf(int.Parse(a[1]));
                if (h == IntPtr.Zero) return 2;
                Focus(h);
                Thread.Sleep(250);
                SendCombo(a[2]);
                return 0;
            }
        }
        catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
        Console.Error.WriteLine("usage: keys focus <hwnd> | keys game <pid> | keys confirm <pid> [secs] | keys send <pid> <combo> | keys freeze|thaw <pid> | keys unmark <hwnd>");
        return 1;
    }
}
