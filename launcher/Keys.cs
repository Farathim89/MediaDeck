// Small helper for the in-game overlay.
//   keys.exe focus <hwnd>          bring a window to the front (Windows normally blocks this
//                                  for programs in the background); exit 0 = it is in front, 3 = Windows refused
//   keys.exe visible <pid>         exit 0 when the program shows a window (minimized counts), 1 when not (in the tray)
//   keys.exe confirm <pid> [secs]  press Yes/OK in that program's own "confirm shutdown/exit" dialog
//                                  (secs: keep looking that long, until it shows or the program is gone)
//   keys.exe ok <pid> <pattern> [secs]  the same for a dialog whose title or text matches the pattern (RPCS3's
//                                  "Successfully installed" message after a PSN package)
//   keys.exe click <pid> <title> <button>  press that button in a window of the program whose title matches
//   keys.exe send <pid> <combo>    bring the game's window (pid or its child) to the front and
//                                  press a key combo, e.g. "F1", "Shift+F1", "Ctrl+P"
//   keys.exe unmark <hwnd>          take the taskbar's "full screen" mark off a window (Chromium sets it; Windows 11's
//                                  Alt+Tab then lists MediaDeck twice after quick switches)
//   keys.exe freeze <pid> / thaw <pid>  stop / continue the program (all its threads) - an emulator stands still
//                                  while MediaDeck's menu is open, so the controller doesn't play the game too
//   keys.exe border <hwnd> none|default  Windows 11's thin window border (a coloured line along the top of a
//                                  borderless window that covers the screen) off / back
//   keys.exe display list <hwnd>   the screen the window is on: its modes and the current one, as JSON
//   keys.exe display set <hwnd> <w> <h> <hz> try|keep|test  try = for now (not saved; a restart / reset goes back),
//                                  keep = saved like Windows' own Display settings, test = only ask Windows if it would work
//   keys.exe display reset <hwnd>  back to the saved mode (undoes a "try")
//   keys.exe pads                  the game controllers Windows has, one per line: "xinput vid pid version subtype slotN" (XInput's
//                                  own ids) and "raw vid pid version 1|0 manufacturer<TAB>product" (raw input; 1 = an XInput pad)
//                                  - where SDL reads them too; pad-pc.js makes SDL's ids from them
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
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);

    // ---------- Screen resolution / refresh rate (Settings → General) ----------
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MONITORINFOEX { public int cbSize; public RECT rcMonitor, rcWork; public int dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr lparam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, IntPtr dm, IntPtr hwnd, int flags, IntPtr lparam);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, int flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFOEX mi);
    const int ENUM_CURRENT_SETTINGS = -1, DM_PELSWIDTH = 0x80000, DM_PELSHEIGHT = 0x100000, DM_DISPLAYFREQUENCY = 0x400000;
    const int CDS_UPDATEREGISTRY = 1, CDS_TEST = 2;

    static string ScreenOf(IntPtr hwnd)
    {
        var mi = new MONITORINFOEX { cbSize = Marshal.SizeOf(typeof(MONITORINFOEX)) };
        return GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref mi) ? mi.szDevice : null;   // MONITOR_DEFAULTTONEAREST
    }

    static DEVMODE NewMode() { var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)); return dm; }

    static int Display(string[] a)
    {
        var dev = ScreenOf(new IntPtr(long.Parse(a[2])));
        if (dev == null) return 2;
        if (a[1] == "list")
        {
            var cur = NewMode();
            EnumDisplaySettings(dev, ENUM_CURRENT_SETTINGS, ref cur);
            var seen = new HashSet<string>();
            var modes = new List<string>();
            var dm = NewMode();
            for (int i = 0; EnumDisplaySettings(dev, i, ref dm); i++)
            {
                if (dm.dmBitsPerPel != 32 || dm.dmDisplayFrequency < 2) continue;   // (1 / 0 Hz = "hardware default")
                var key = dm.dmPelsWidth + "x" + dm.dmPelsHeight + "@" + dm.dmDisplayFrequency;
                if (seen.Add(key)) modes.Add("{\"w\":" + dm.dmPelsWidth + ",\"h\":" + dm.dmPelsHeight + ",\"hz\":" + dm.dmDisplayFrequency + "}");
                dm = NewMode();
            }
            Console.WriteLine("{\"device\":\"" + dev.Replace("\\", "\\\\") + "\",\"current\":{\"w\":" + cur.dmPelsWidth + ",\"h\":" + cur.dmPelsHeight +
                ",\"hz\":" + cur.dmDisplayFrequency + "},\"modes\":[" + string.Join(",", modes) + "]}");
            return 0;
        }
        if (a[1] == "reset") return ChangeDisplaySettingsEx(dev, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero) == 0 ? 0 : 3;
        if (a[1] == "set" && a.Length >= 7)
        {
            var dm = NewMode();
            EnumDisplaySettings(dev, ENUM_CURRENT_SETTINGS, ref dm);
            dm.dmPelsWidth = int.Parse(a[3]); dm.dmPelsHeight = int.Parse(a[4]); dm.dmDisplayFrequency = int.Parse(a[5]);
            dm.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
            int flags = a[6] == "keep" ? CDS_UPDATEREGISTRY : a[6] == "test" ? CDS_TEST : 0;
            int r = ChangeDisplaySettingsEx(dev, ref dm, IntPtr.Zero, flags, IntPtr.Zero);
            Console.WriteLine(r);
            return r == 0 ? 0 : 3;
        }
        return 1;
    }
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

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool altTab);

    // Windows lets a program take the foreground right after a key event: tap Alt first. When that isn't
    // enough, share the input of the window in front for a moment (Windows then counts us as that program),
    // and last Windows' own Alt+Tab switch. True when the window really is in front.
    static bool Focus(IntPtr h)
    {
        if (IsIconic(h)) ShowWindow(h, 9);
        for (int i = 0; i < 3; i++)
        {
            if (GetForegroundWindow() == h) return true;
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            keybd_event(0x12, 0, KEYUP, UIntPtr.Zero);
            SetForegroundWindow(h);
            if (GetForegroundWindow() == h) return true;
            uint pid, front = GetWindowThreadProcessId(GetForegroundWindow(), out pid), me = GetCurrentThreadId();
            bool shared = front != 0 && front != me && AttachThreadInput(me, front, true);
            BringWindowToTop(h);
            SetForegroundWindow(h);
            if (shared) AttachThreadInput(me, front, false);
            if (GetForegroundWindow() == h) return true;
            SwitchToThisWindow(h, true);
            Thread.Sleep(80);
        }
        return GetForegroundWindow() == h;
    }

    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);

    // Does the program still show its main window (minimized counts)? An app that hides to the tray when closed
    // doesn't. Only windows without an owner: PlexDeck's player layers (owned by its main window) can stay shown
    // a moment after the main one hid.
    static bool Visible(int pid)
    {
        bool any = false;
        EnumWindows((h, p) =>
        {
            uint wp; GetWindowThreadProcessId(h, out wp);
            RECT r;
            if (wp == pid && IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero && GetWindowRect(h, out r) && (IsIconic(h) || (r.R - r.L >= 200 && r.B - r.T >= 150))) { any = true; return false; }
            return true;
        }, IntPtr.Zero);
        return any;
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

    // keys.exe click <pid> <title> <button>: press the button of that name in a window of the program whose title
    // matches (RPCS3 installing a package: "Loading games" -> Cancel, "PKG Installation" -> Install)
    static bool Click(int pid, System.Text.RegularExpressions.Regex title, string button)
    {
        var root = System.Windows.Automation.AutomationElement.RootElement;
        var mine = new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.ProcessIdProperty, pid);
        var isWindow = new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.ControlTypeProperty, System.Windows.Automation.ControlType.Window);
        var isButton = new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.ControlTypeProperty, System.Windows.Automation.ControlType.Button);
        var windows = new List<System.Windows.Automation.AutomationElement>();
        foreach (System.Windows.Automation.AutomationElement top in root.FindAll(System.Windows.Automation.TreeScope.Children, mine))
        {
            windows.Add(top);
            foreach (System.Windows.Automation.AutomationElement inner in top.FindAll(System.Windows.Automation.TreeScope.Descendants, isWindow)) windows.Add(inner);
        }
        foreach (var w in windows)
        {
            if (!title.IsMatch(w.Current.Name ?? "")) continue;
            foreach (System.Windows.Automation.AutomationElement b in w.FindAll(System.Windows.Automation.TreeScope.Descendants, isButton))
            {
                if (!(b.Current.Name ?? "").Replace("&", "").Trim().Equals(button, StringComparison.OrdinalIgnoreCase)) continue;
                object pat;
                if (b.Current.IsEnabled && b.TryGetCurrentPattern(System.Windows.Automation.InvokePattern.Pattern, out pat))
                { ((System.Windows.Automation.InvokePattern)pat).Invoke(); return true; }
            }
        }
        return false;
    }

    // Emulators like PCSX2 ask "Are you sure you want to shut down?" on close. Press Yes/OK,
    // but only in a dialog of that program whose title is about closing.
    // only: a dialog's title or text to look for instead of the "about closing" ones (keys.exe ok <pid> <pattern>)
    static bool Confirm(int pid, System.Text.RegularExpressions.Regex only = null)
    {
        var titles = only ?? new System.Text.RegularExpressions.Regex("confirm|shut ?down|exit|quit|close|stop", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
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
                    if (only != null ? only.IsMatch(x.Current.Name ?? "") :
                        System.Text.RegularExpressions.Regex.IsMatch(x.Current.Name ?? "", "(?i)\\b(exit|quit|shut ?down|close|stop)\\b.*\\?|\\bsure\\b.*\\b(exit|quit|shut ?down|close|stop)\\b")) { aboutClosing = true; break; }
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

    // ---- pads: the game controllers in Windows' raw input list ----
    [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICELIST { public IntPtr hDevice; public uint dwType; }
    [StructLayout(LayoutKind.Explicit, Size = 32)] struct RID_DEVICE_INFO
    {
        [FieldOffset(0)] public uint cbSize; [FieldOffset(4)] public uint dwType;
        [FieldOffset(8)] public uint dwVendorId; [FieldOffset(12)] public uint dwProductId; [FieldOffset(16)] public uint dwVersionNumber;
        [FieldOffset(20)] public ushort usUsagePage; [FieldOffset(22)] public ushort usUsage;
    }
    [DllImport("user32.dll")] static extern uint GetRawInputDeviceList([Out] RAWINPUTDEVICELIST[] list, ref uint count, uint size);
    [DllImport("user32.dll", EntryPoint = "GetRawInputDeviceInfoW")] static extern uint GetRawInputDeviceInfo(IntPtr h, uint cmd, IntPtr data, ref uint size);
    [DllImport("user32.dll", EntryPoint = "GetRawInputDeviceInfoW", CharSet = CharSet.Unicode)] static extern uint GetRawInputDeviceName(IntPtr h, uint cmd, System.Text.StringBuilder name, ref uint size);
    // XInputGetCapabilitiesEx (xinput1_4 #108): the pad's USB ids and version, as SDL takes them for its id
    [StructLayout(LayoutKind.Explicit, Size = 32)] struct XINPUT_CAPABILITIES_EX
    {
        [FieldOffset(0)] public byte Type; [FieldOffset(1)] public byte SubType;
        [FieldOffset(20)] public ushort VendorId; [FieldOffset(22)] public ushort ProductId; [FieldOffset(24)] public ushort ProductVersion;
    }
    [DllImport("xinput1_4.dll", EntryPoint = "#108")] static extern uint XInputGetCapabilitiesEx(uint one, uint user, uint flags, out XINPUT_CAPABILITIES_EX caps);
    // the device's own manufacturer / product text (SDL's raw input ids are made with them)
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
    [DllImport("hid.dll")] static extern bool HidD_GetManufacturerString(IntPtr h, byte[] buffer, int length);
    [DllImport("hid.dll")] static extern bool HidD_GetProductString(IntPtr h, byte[] buffer, int length);
    static string HidText(IntPtr h, bool product)
    {
        var b = new byte[256];
        if (!(product ? HidD_GetProductString(h, b, b.Length) : HidD_GetManufacturerString(h, b, b.Length))) return "";
        string s = System.Text.Encoding.Unicode.GetString(b);
        int z = s.IndexOf('\0');
        return (z >= 0 ? s.Substring(0, z) : s).Replace('\t', ' ');
    }
    static int Pads()
    {
        for (uint u = 0; u < 4; u++)
        {
            XINPUT_CAPABILITIES_EX c;
            try { if (XInputGetCapabilitiesEx(1, u, 0, out c) != 0) continue; } catch { break; }   // (no xinput1_4: Windows 7)
            Console.WriteLine(string.Format("xinput {0:x4} {1:x4} {2:x4} {3:x2} slot{4}", c.VendorId, c.ProductId, c.ProductVersion, c.SubType, u));
        }
        uint n = 0, sz = (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICELIST));
        GetRawInputDeviceList(null, ref n, sz);
        var list = new RAWINPUTDEVICELIST[n];
        if (n == 0 || GetRawInputDeviceList(list, ref n, sz) == uint.MaxValue) return 3;
        foreach (var d in list)
        {
            if (d.dwType != 2) continue;                                        // RIM_TYPEHID
            uint isz = 32;
            IntPtr p = Marshal.AllocHGlobal(32);
            RID_DEVICE_INFO info;
            try
            {
                Marshal.WriteInt32(p, 32);
                if (GetRawInputDeviceInfo(d.hDevice, 0x2000000b, p, ref isz) == uint.MaxValue) continue;   // RIDI_DEVICEINFO
                info = (RID_DEVICE_INFO)Marshal.PtrToStructure(p, typeof(RID_DEVICE_INFO));
            }
            finally { Marshal.FreeHGlobal(p); }
            // joystick, game pad, multi-axis controller
            if (info.usUsagePage != 1 || (info.usUsage != 4 && info.usUsage != 5 && info.usUsage != 8)) continue;
            uint nsz = 0;
            GetRawInputDeviceName(d.hDevice, 0x20000007, null, ref nsz);                                  // RIDI_DEVICENAME
            var sb = new System.Text.StringBuilder((int)nsz + 2);
            GetRawInputDeviceName(d.hDevice, 0x20000007, sb, ref nsz);
            string name = sb.ToString(), mfr = "", prod = "";
            IntPtr f = CreateFile(name, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);                   // no access needed, share read / write, OPEN_EXISTING
            if (f != new IntPtr(-1)) { mfr = HidText(f, false); prod = HidText(f, true); CloseHandle(f); }
            Console.WriteLine(string.Format("raw {0:x4} {1:x4} {2:x4} {3} {4}\t{5}", info.dwVendorId & 0xffff, info.dwProductId & 0xffff, info.dwVersionNumber & 0xffff,
                name.IndexOf("IG_", StringComparison.OrdinalIgnoreCase) >= 0 ? 1 : 0, mfr, prod));
        }
        return 0;
    }

    static int Main(string[] a)
    {
        try
        {
            if (a.Length >= 1 && a[0] == "pads") return Pads();
            if (a.Length >= 2 && a[0] == "unmark")
            {
                var tb = (ITaskbarList2)new TaskbarList();
                tb.HrInit();
                tb.MarkFullscreenWindow(new IntPtr(long.Parse(a[1])), false);
                return 0;
            }
            if (a.Length >= 3 && a[0] == "display") return Display(a);
            if (a.Length >= 3 && a[0] == "border")
            {
                int c = a[2] == "none" ? unchecked((int)0xFFFFFFFE) : unchecked((int)0xFFFFFFFF);   // DWMWA_COLOR_NONE / _DEFAULT
                return DwmSetWindowAttribute(new IntPtr(long.Parse(a[1])), 34, ref c, 4) == 0 ? 0 : 3;   // DWMWA_BORDER_COLOR (Windows 11)
            }
            if (a.Length >= 2 && (a[0] == "freeze" || a[0] == "thaw"))
            {
                var p = OpenProcess(0x0800, false, int.Parse(a[1]));   // PROCESS_SUSPEND_RESUME
                if (p == IntPtr.Zero) return 2;
                int r = a[0] == "freeze" ? NtSuspendProcess(p) : NtResumeProcess(p);
                CloseHandle(p);
                return r == 0 ? 0 : 3;
            }
            if (a.Length >= 2 && a[0] == "focus") return Focus(new IntPtr(long.Parse(a[1]))) ? 0 : 3;
            if (a.Length >= 2 && a[0] == "game") { var h = WindowOf(int.Parse(a[1])); if (h == IntPtr.Zero) return 2; return Focus(h) ? 0 : 3; }
            if (a.Length >= 2 && a[0] == "visible") return Visible(int.Parse(a[1])) ? 0 : 1;
            if (a.Length >= 4 && a[0] == "click")
            {
                var t = new System.Text.RegularExpressions.Regex(a[2], System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                return Click(int.Parse(a[1]), t, a[3]) ? 0 : 3;
            }
            if ((a.Length >= 2 && a[0] == "confirm") || (a.Length >= 3 && a[0] == "ok"))
            {
                int pid = int.Parse(a[1]);
                var only = a[0] == "ok" ? new System.Text.RegularExpressions.Regex(a[2], System.Text.RegularExpressions.RegexOptions.IgnoreCase) : null;
                int si = a[0] == "ok" ? 3 : 2;
                var until = DateTime.Now.AddSeconds(a.Length > si ? double.Parse(a[si], System.Globalization.CultureInfo.InvariantCulture) : 0);
                do
                {
                    if (Confirm(pid, only)) return 0;
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
        Console.Error.WriteLine("usage: keys focus <hwnd> | keys game <pid> | keys confirm <pid> [secs] | keys send <pid> <combo> | keys freeze|thaw <pid> | keys unmark <hwnd> | keys border <hwnd> none|default | keys display list|reset <hwnd> | keys display set <hwnd> <w> <h> <hz> try|keep|test");
        return 1;
    }
}
