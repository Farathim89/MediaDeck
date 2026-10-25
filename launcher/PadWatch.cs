// Watches the controllers while a game/app started from MediaDeck is running and prints
// "home" when the player wants to go back:
//   Xbox (XInput):             Guide button, or Back + Start held 1 s
//   PlayStation (DS4/DualSense, USB or Bluetooth, read as HID): PS button, or Share + Options held 1 s
// It only reads (shared access), so the game keeps getting the controller as normal.
// It also prints the menu buttons as they go down / up ("+down", "-down"), from every Xbox slot and every PlayStation
// pad (no controller ids): MediaDeck's page uses them when Chromium's own controller list missed the controller.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

static class PadWatch
{
    // ---------- XInput ----------
    [StructLayout(LayoutKind.Sequential)] struct XPad { public ushort Buttons; public byte LT, RT; public short LX, LY, RX, RY; }
    [StructLayout(LayoutKind.Sequential)] struct XState { public uint Packet; public XPad Pad; }
    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")] static extern int XGet(int i, ref XState s);
    [DllImport("xinput1_4.dll", EntryPoint = "#100")] static extern int XGetEx(int i, ref XState s);   // also reports Guide

    // ---------- HID ----------
    [StructLayout(LayoutKind.Sequential)] struct SpDeviceInterfaceData { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }
    [StructLayout(LayoutKind.Sequential)] struct HidAttributes { public int Size; public ushort VendorID, ProductID, VersionNumber; }
    [StructLayout(LayoutKind.Sequential)] struct HidCaps
    {
        public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
        public ushort NumberLinkCollectionNodes, NumberInputButtonCaps, NumberInputValueCaps, NumberInputDataIndices,
            NumberOutputButtonCaps, NumberOutputValueCaps, NumberOutputDataIndices, NumberFeatureButtonCaps, NumberFeatureValueCaps, NumberFeatureDataIndices;
    }
    [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
    [DllImport("hid.dll")] static extern bool HidD_GetAttributes(SafeFileHandle h, ref HidAttributes a);
    [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr p);
    [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr p);
    [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr p, ref HidCaps c);
    [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr e, IntPtr w, int flags);
    [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr info, ref Guid g, int i, ref SpDeviceInterfaceData d);
    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Auto)]
    static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SpDeviceInterfaceData d, IntPtr detail, int size, out int required, IntPtr info);
    [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);

    // Pressed state per source, combined by the main loop
    static volatile bool psHome, psCombo;
    static bool Debug;
    static string lastRaw = "";
    static readonly HashSet<string> open = new HashSet<string>();
    static readonly object gate = new object();

    // ---------- The menu buttons (MediaDeck's actions; D-pad or left stick for the directions) ----------
    static readonly string[] NavNames = { "up", "down", "left", "right", "ok", "back", "x", "menu", "lb", "rb", "start", "select" };
    // XInput's bit for each of them: D-pad, A, B, X, Y, LB, RB, Start, Back
    static readonly int[] XboxBits = { 0x0001, 0x0002, 0x0004, 0x0008, 0x1000, 0x2000, 0x4000, 0x8000, 0x0100, 0x0200, 0x0010, 0x0020 };
    // per PlayStation pad: { past 0.55 on the stick, past 0.45 } - a stick direction goes on at 0.55 and off below 0.45
    static readonly Dictionary<string, int[]> sonyNav = new Dictionary<string, int[]>();

    static int StickNav(double x, double y, double t)
    {
        return (y < -t ? 1 : 0) | (y > t ? 2 : 0) | (x < -t ? 4 : 0) | (x > t ? 8 : 0);
    }

    static int XboxNav(XPad p, double t)
    {
        int n = 0;
        for (int k = 0; k < XboxBits.Length; k++) if ((p.Buttons & XboxBits[k]) != 0) n |= 1 << k;
        return n | StickNav(p.LX / 32767.0, -p.LY / 32767.0, t);
    }

    // DS4 / DualSense: the D-pad is a hat in the low half of the face-button byte (0 = up, clockwise, 8 = none)
    static int SonyNav(int face, int b6, int lx, int ly, double t)
    {
        int n = 0, hat = face & 0x0F;
        if (hat == 0 || hat == 1 || hat == 7) n |= 1;
        if (hat >= 3 && hat <= 5) n |= 2;
        if (hat >= 5 && hat <= 7) n |= 4;
        if (hat >= 1 && hat <= 3) n |= 8;
        if ((face & 0x20) != 0) n |= 16;    // cross: ok
        if ((face & 0x40) != 0) n |= 32;    // circle: back
        if ((face & 0x10) != 0) n |= 64;    // square: x
        if ((face & 0x80) != 0) n |= 128;   // triangle: menu
        if ((b6 & 0x01) != 0) n |= 256;     // L1
        if ((b6 & 0x02) != 0) n |= 512;     // R1
        if ((b6 & 0x20) != 0) n |= 1024;    // Options: start
        if ((b6 & 0x10) != 0) n |= 2048;    // Share / Create: select
        return n | StickNav((lx - 128) / 127.5, (ly - 128) / 127.5, t);
    }

    static List<string> HidPaths()
    {
        var list = new List<string>();
        Guid g; HidD_GetHidGuid(out g);
        IntPtr set = SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, 0x12); // PRESENT | DEVICEINTERFACE
        var d = new SpDeviceInterfaceData { cbSize = Marshal.SizeOf(typeof(SpDeviceInterfaceData)) };
        for (int i = 0; SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref d); i++)
        {
            int need; SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out need, IntPtr.Zero);
            IntPtr buf = Marshal.AllocHGlobal(need);
            Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
            if (SetupDiGetDeviceInterfaceDetail(set, ref d, buf, need, out need, IntPtr.Zero))
                list.Add(Marshal.PtrToStringAuto(new IntPtr(buf.ToInt64() + 4)));
            Marshal.FreeHGlobal(buf);
        }
        SetupDiDestroyDeviceInfoList(set);
        return list;
    }

    static bool IsSony(ushort vid, ushort pid)
    {
        if (vid != 0x054C) return false;
        // DualShock 4 (v1, v2, wireless adapter), DualSense, DualSense Edge
        return pid == 0x05C4 || pid == 0x09CC || pid == 0x0BA0 || pid == 0x0CE6 || pid == 0x0DF2;
    }

    // Start a reader thread for every PlayStation controller not yet open
    static void FindSonyPads()
    {
        foreach (var p in HidPaths())
        {
            lock (gate) { if (open.Contains(p)) continue; }
            var h = CreateFile(p, 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero); // GENERIC_READ, share read+write
            if (h.IsInvalid) continue;
            var a = new HidAttributes { Size = Marshal.SizeOf(typeof(HidAttributes)) };
            if (!HidD_GetAttributes(h, ref a) || !IsSony(a.VendorID, a.ProductID)) { h.Dispose(); continue; }
            IntPtr pre; int len = 64;
            if (HidD_GetPreparsedData(h, out pre))
            {
                var caps = new HidCaps(); HidP_GetCaps(pre, ref caps); HidD_FreePreparsedData(pre);
                if (caps.InputReportByteLength > 0) len = caps.InputReportByteLength;
            }
            bool dualSense = a.ProductID == 0x0CE6 || a.ProductID == 0x0DF2;
            lock (gate) open.Add(p);
            var t = new Thread(() => ReadSony(p, h, len, dualSense)) { IsBackground = true };
            t.Start();
        }
    }

    static void ReadSony(string path, SafeFileHandle h, int len, bool dualSense)
    {
        try
        {
            using (var fs = new FileStream(h, FileAccess.Read, len, false))
            {
                var r = new byte[len];
                int lastOn = -1, lastHold = -1;
                while (true)
                {
                    int n = fs.Read(r, 0, len);
                    if (n <= 0) break;
                    int face, b6, b7, lx, ly;             // D-pad + face buttons, byte with Share/Options, byte with PS, left stick
                    if (!dualSense)
                    {
                        // DS4: 0x01 = USB or Bluetooth "simple" report, 0x11 = Bluetooth full report (2 bytes further)
                        int o = r[0] == 0x11 ? 2 : 0;
                        if (r[0] != 0x01 && r[0] != 0x11) continue;
                        lx = r[1 + o]; ly = r[2 + o]; face = r[5 + o]; b6 = r[6 + o]; b7 = r[7 + o];
                    }
                    else
                    {
                        // DualSense: 0x01 over USB (buttons at 8..10), 0x01 over Bluetooth simple (DS4 layout), 0x31 Bluetooth full
                        if (r[0] == 0x31) { lx = r[2]; ly = r[3]; face = r[9]; b6 = r[10]; b7 = r[11]; }
                        else if (r[0] == 0x01 && n >= 64) { lx = r[1]; ly = r[2]; face = r[8]; b6 = r[9]; b7 = r[10]; }
                        else if (r[0] == 0x01) { lx = r[1]; ly = r[2]; face = r[5]; b6 = r[6]; b7 = r[7]; }
                        else continue;
                    }
                    int on = SonyNav(face, b6, lx, ly, 0.55), hold = SonyNav(face, b6, lx, ly, 0.45);
                    if (on != lastOn || hold != lastHold) { lastOn = on; lastHold = hold; lock (gate) sonyNav[path] = new[] { on, hold }; }
                    if (Debug)
                    {
                        // report type + the button bytes only (sticks would flood the output)
                        string raw = r[0].ToString("X2") + " | " + BitConverter.ToString(r, 5, Math.Min(n - 5, 7));
                        if (raw != lastRaw) { lastRaw = raw; Console.WriteLine("raw " + raw); }
                    }
                    psCombo = (b6 & 0x10) != 0 && (b6 & 0x20) != 0;  // Share + Options
                    psHome = (b7 & 0x01) != 0;                     // PS button
                }
            }
        }
        catch { }
        psHome = false; psCombo = false;
        lock (gate) { open.Remove(path); sonyNav.Remove(path); }  // unplugged: found again later
    }

    static bool ReadXbox(int i, out XState s)
    {
        s = new XState();
        try { if (XGetEx(i, ref s) == 0) return true; } catch { }
        try { if (XGet(i, ref s) == 0) return true; } catch { }
        return false;
    }

    // ---------- Other pads (set up in MediaDeck's Settings → Controllers), read with Windows' joystick API ----------
    [StructLayout(LayoutKind.Sequential)] struct JoyInfoEx { public int Size, Flags, X, Y, Z, R, U, V; public uint Buttons; public int ButtonNumber, Pov, Res1, Res2; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct JoyCaps
    {
        public ushort Mid, Pid;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
        public uint Xmin, Xmax, Ymin, Ymax, Zmin, Zmax, NumButtons, PeriodMin, PeriodMax, Rmin, Rmax, Umin, Umax, Vmin, Vmax, Caps, MaxAxes, NumAxes, MaxButtons;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string RegKey;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string OemVxD;
    }
    [DllImport("winmm.dll", EntryPoint = "joyGetDevCapsW", CharSet = CharSet.Unicode)] static extern int JoyGetCaps(IntPtr id, ref JoyCaps c, int size);
    [DllImport("winmm.dll", EntryPoint = "joyGetPosEx")] static extern int JoyGetPos(int id, ref JoyInfoEx i);

    // "--pad 0810:e501=9+8": that pad's Start and Back buttons (from 0)
    static readonly Dictionary<string, int[]> padCombos = new Dictionary<string, int[]>();
    static readonly List<KeyValuePair<int, int[]>> joys = new List<KeyValuePair<int, int[]>>();   // joystick id → { start, back }

    // looking at ids nobody uses is slow in winmm, so the list is made every few seconds and only these are read
    static void FindOtherPads()
    {
        if (padCombos.Count == 0) return;
        var found = new List<KeyValuePair<int, int[]>>();
        for (int id = 0; id < 16; id++)
        {
            var c = new JoyCaps();
            if (JoyGetCaps((IntPtr)id, ref c, Marshal.SizeOf(typeof(JoyCaps))) != 0) continue;
            var info = new JoyInfoEx { Size = Marshal.SizeOf(typeof(JoyInfoEx)), Flags = 0x80 };
            if (JoyGetPos(id, ref info) != 0) continue;                // not plugged in
            int[] sb;
            if (padCombos.TryGetValue(c.Mid.ToString("x4") + ":" + c.Pid.ToString("x4"), out sb)) found.Add(new KeyValuePair<int, int[]>(id, sb));
        }
        lock (joys) { joys.Clear(); joys.AddRange(found); }
        if (Debug) Console.WriteLine("other pads: " + found.Count);
    }

    static bool OtherCombo()
    {
        lock (joys)
            foreach (var j in joys)
            {
                var info = new JoyInfoEx { Size = Marshal.SizeOf(typeof(JoyInfoEx)), Flags = 0x80 };   // JOY_RETURNBUTTONS
                if (JoyGetPos(j.Key, ref info) != 0) continue;
                if ((info.Buttons & (1u << j.Value[0])) != 0 && (info.Buttons & (1u << j.Value[1])) != 0) return true;
            }
        return false;
    }

    static void Main(string[] args)
    {
        bool debug = Array.IndexOf(args, "--debug") >= 0;
        Debug = debug;
        for (int a = 0; a + 1 < args.Length; a++)
        {
            if (args[a] != "--pad") continue;
            var kv = args[a + 1].Split('=');
            var sb = kv.Length == 2 ? kv[1].Split('+') : new string[0];
            int s, b;
            if (sb.Length == 2 && int.TryParse(sb[0], out s) && int.TryParse(sb[1], out b) && s >= 0 && s < 32 && b >= 0 && b < 32)
                padCombos[kv[0].ToLowerInvariant()] = new[] { s, b };
        }
        DateTime comboSince = DateTime.MaxValue, lastScan = DateTime.MinValue;
        bool fired = false;
        int lastNav = 0;
        while (true)
        {
            if ((DateTime.Now - lastScan).TotalSeconds > 3) { lastScan = DateTime.Now; try { FindSonyPads(); } catch { } try { FindOtherPads(); } catch { } }
            ushort x = 0;
            int navOn = 0, navHold = 0;
            for (int i = 0; i < 4; i++)
            {
                XState s;
                if (!ReadXbox(i, out s)) continue;
                x |= s.Pad.Buttons;
                navOn |= XboxNav(s.Pad, 0.55); navHold |= XboxNav(s.Pad, 0.45);
            }
            lock (gate) foreach (var v in sonyNav.Values) { navOn |= v[0]; navHold |= v[1]; }
            int nav = navOn | (lastNav & navHold);
            if (nav != lastNav)
            {
                for (int k = 0; k < NavNames.Length; k++)
                    if (((nav ^ lastNav) & (1 << k)) != 0) Console.WriteLine(((nav & (1 << k)) != 0 ? "+" : "-") + NavNames[k]);
                Console.Out.Flush();
                lastNav = nav;
            }
            bool other = false;
            try { other = OtherCombo(); } catch { }
            bool combo = ((x & 0x0020) != 0 && (x & 0x0010) != 0) || psCombo || other;   // Back+Start / Share+Options / a set-up pad's Start+Back
            bool home = (x & 0x0400) != 0 || psHome;                           // Guide / PS
            if (combo && comboSince == DateTime.MaxValue) comboSince = DateTime.Now;
            if (!combo) comboSince = DateTime.MaxValue;
            bool trigger = home || (combo && (DateTime.Now - comboSince).TotalMilliseconds >= 1000);
            if (debug && (combo || home)) Console.WriteLine("pressed: " + (home ? "home " : "") + (combo ? "combo" : ""));
            if (trigger && !fired) { Console.WriteLine("home"); Console.Out.Flush(); fired = true; }
            // Let MediaDeck know the button was let go (for "hold to close")
            if (!combo && !home && fired) { Console.WriteLine("release"); Console.Out.Flush(); fired = false; }
            Thread.Sleep(50);
        }
    }
}
