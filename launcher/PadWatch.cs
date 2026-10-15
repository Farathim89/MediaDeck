// Watches the controllers while a game/app started from MediaDeck is running and prints
// "home" when the player wants to go back:
//   Xbox (XInput):             Guide button, or Back + Start held 1 s
//   PlayStation (DS4/DualSense, USB or Bluetooth, read as HID): PS button, or Share + Options held 1 s
// It only reads (shared access), so the game keeps getting the controller as normal.
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
                while (true)
                {
                    int n = fs.Read(r, 0, len);
                    if (n <= 0) break;
                    int b6, b7;                           // byte with Share/Options, byte with PS
                    if (!dualSense)
                    {
                        // DS4: 0x01 = USB or Bluetooth "simple" report, 0x11 = Bluetooth full report (2 bytes further)
                        int o = r[0] == 0x11 ? 2 : 0;
                        if (r[0] != 0x01 && r[0] != 0x11) continue;
                        b6 = r[6 + o]; b7 = r[7 + o];
                    }
                    else
                    {
                        // DualSense: 0x01 over USB (buttons at 8..10), 0x01 over Bluetooth simple (DS4 layout), 0x31 Bluetooth full
                        if (r[0] == 0x31) { b6 = r[10]; b7 = r[11]; }
                        else if (r[0] == 0x01 && n >= 64) { b6 = r[9]; b7 = r[10]; }
                        else if (r[0] == 0x01) { b6 = r[6]; b7 = r[7]; }
                        else continue;
                    }
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
        lock (gate) open.Remove(path);                            // unplugged: found again later
    }

    static ushort ReadXbox(int i)
    {
        var s = new XState();
        try { if (XGetEx(i, ref s) == 0) return s.Pad.Buttons; } catch { }
        try { if (XGet(i, ref s) == 0) return s.Pad.Buttons; } catch { }
        return 0;
    }

    static void Main(string[] args)
    {
        bool debug = args.Length > 0 && args[0] == "--debug";
        Debug = debug;
        DateTime comboSince = DateTime.MaxValue, lastScan = DateTime.MinValue;
        bool fired = false;
        while (true)
        {
            if ((DateTime.Now - lastScan).TotalSeconds > 3) { lastScan = DateTime.Now; try { FindSonyPads(); } catch { } }
            ushort x = 0;
            for (int i = 0; i < 4; i++) x |= ReadXbox(i);
            bool combo = ((x & 0x0020) != 0 && (x & 0x0010) != 0) || psCombo;   // Back+Start / Share+Options
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
