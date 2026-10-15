// Hides the mouse pointer in full-screen programs (games, emulators, apps, MediaDeck) when the
// mouse has not moved for a while, and shows it again on the first move, or as soon as the window
// in front is no longer full screen (the desktop and normal windows always keep it). Started by MediaDeck:
//   cursorhide.exe <seconds> <MediaDeck's process id>   - watch until MediaDeck is gone
//   cursorhide.exe --restore                                - only put the normal pointers back
// Hiding = every system pointer is swapped for an empty one (SetSystemCursor); showing = Windows
// reloads the user's own pointer scheme (SPI_SETCURSORS). The pointers always come back when this
// stops: on a move, when MediaDeck closes, on Ctrl+C / log off, and on any error.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

static class CursorHide
{
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern bool SetSystemCursor(IntPtr cursor, uint id);
    [DllImport("user32.dll")] static extern IntPtr CreateCursor(IntPtr inst, int x, int y, int w, int h, byte[] and, byte[] xor);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, IntPtr pv, uint ini);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr w, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr w, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO i);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr w, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr w);
    delegate bool ConsoleHandler(int type);
    [DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(ConsoleHandler h, bool add);

    const uint SPI_SETCURSORS = 0x57;
    // arrow, I-beam, wait, cross, up, the four sizes, size-all, no, hand, app-starting, help, pin, person
    static readonly uint[] IDS = { 32512, 32513, 32514, 32515, 32516, 32642, 32643, 32644, 32645, 32646, 32648, 32649, 32650, 32651, 32671, 32672 };
    static bool hidden;
    static ConsoleHandler keep;   // kept alive for the console handler

    static void Hide()
    {
        if (hidden) return;
        var and = new byte[32 * 4]; for (int i = 0; i < and.Length; i++) and[i] = 0xFF;   // fully see-through
        var xor = new byte[32 * 4];
        foreach (var id in IDS) SetSystemCursor(CreateCursor(IntPtr.Zero, 0, 0, 32, 32, and, xor), id);
        hidden = true;
    }

    static void Show()
    {
        SystemParametersInfo(SPI_SETCURSORS, 0, IntPtr.Zero, 0);
        hidden = false;
    }

    // The window in front covers its whole screen (and is not the desktop or the taskbar)
    static bool FullScreen()
    {
        IntPtr w = GetForegroundWindow();
        if (w == IntPtr.Zero || !IsWindowVisible(w)) return false;
        var cls = new System.Text.StringBuilder(64);
        GetClassName(w, cls, cls.Capacity);
        string c = cls.ToString();
        if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return false;
        RECT r;
        if (!GetWindowRect(w, out r)) return false;
        var mi = new MONITORINFO { Size = Marshal.SizeOf(typeof(MONITORINFO)) };
        if (!GetMonitorInfo(MonitorFromWindow(w, 2), ref mi)) return false;
        return r.Left <= mi.Monitor.Left && r.Top <= mi.Monitor.Top && r.Right >= mi.Monitor.Right && r.Bottom >= mi.Monitor.Bottom;
    }

    // a mouse button counts as using the mouse too
    static bool Buttons() { return (GetAsyncKeyState(0x01) & 0x8000) != 0 || (GetAsyncKeyState(0x02) & 0x8000) != 0 || (GetAsyncKeyState(0x04) & 0x8000) != 0; }

    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--restore") { Show(); return 0; }
        int seconds = 10, parent = 0;
        if (args.Length > 0) int.TryParse(args[0], out seconds);
        if (args.Length > 1) int.TryParse(args[1], out parent);
        if (seconds < 2) seconds = 2;
        keep = t => { Show(); return false; };
        SetConsoleCtrlHandler(keep, true);
        Process owner = null;
        try { if (parent > 0) owner = Process.GetProcessById(parent); } catch { return 1; }
        try
        {
            POINT last; GetCursorPos(out last);
            var still = Stopwatch.StartNew();
            while (owner == null || !owner.HasExited)
            {
                Thread.Sleep(200);
                POINT p;
                if (!GetCursorPos(out p)) continue;   // a secure desktop (lock screen, UAC): nothing to do
                bool full = FullScreen();
                if (p.X != last.X || p.Y != last.Y || Buttons())
                {
                    last = p;
                    still.Restart();
                    if (hidden) Show();
                }
                else if (hidden && !full) Show();   // a normal window or the desktop came in front
                else if (!hidden && full && still.Elapsed.TotalSeconds >= seconds) Hide();
            }
        }
        finally { Show(); }
        return 0;
    }
}
