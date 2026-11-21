using System;
using System.IO;
using System.Runtime.InteropServices;

internal static class DesktopShortcut
{
    internal static bool Ensure(string desktop, string game, string cache)
    {
        try
        {
            if (String.IsNullOrEmpty(desktop)) return false;
            string target = Path.Combine(game, "WebPuzzle.exe");
            if (!File.Exists(target)) return false;
            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell", true));
            try
            {
                string path = Path.Combine(desktop, "WebPuzzle.lnk");
                dynamic link = shell.CreateShortcut(path);
                try
                {
                    if (File.Exists(path))
                    {
                        string previous = link.TargetPath;
                        if (String.Equals(previous, target, StringComparison.OrdinalIgnoreCase)) return true;
                        // Update links into our versioned cache, preserving user-created links to other apps.
                        if (String.IsNullOrEmpty(previous) ||
                            !Path.GetFullPath(previous).StartsWith(cache + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                            return false;
                    }
                    link.TargetPath = target;
                    link.WorkingDirectory = game;
                    link.Description = "WebPuzzle";
                    link.Save();
                    return true;
                }
                finally { Marshal.ReleaseComObject(link); }
            }
            finally { Marshal.ReleaseComObject(shell); }
        }
        catch (Exception error)
        {
            if (!(error is COMException || error is IOException || error is UnauthorizedAccessException ||
                error is ArgumentException || error is System.Security.SecurityException ||
                error is Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)) throw;
            return false;
        }
    }
}
