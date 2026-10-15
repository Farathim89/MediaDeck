// MediaDeck launcher: starts the app (Electron) from the folder this .exe is in,
// without a console window.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Launcher
{
    [STAThread]
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string electron = Path.Combine(dir, @"node_modules\electron\dist\electron.exe");
        if (!File.Exists(electron))
        {
            MessageBox.Show(
                "Electron was not found:\n" + electron + "\n\nRun \"npm install\" in this folder first.",
                "MediaDeck", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        var start = new ProcessStartInfo(electron, "\"" + dir + "\"");
        start.WorkingDirectory = dir;
        start.UseShellExecute = false;
        Process.Start(start);
    }
}
