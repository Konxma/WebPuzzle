using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed partial class WebPuzzleLauncher
{
#if EMBEDDED_PACKAGE
    private string root;
#else
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
#endif
    private readonly string address = "http://localhost:" +
        (Environment.GetEnvironmentVariable("WEBPUZZLE_PORT") ?? "5174") + "/";
    private Process server;
    private bool ready;
    private bool busy;

#if EMBEDDED_PACKAGE
    private async Task PrepareGame()
    {
        busy = true;
        SetState("Готуємо файли гри…");
        string message;
        try
        {
            root = await Task.Run(() => EmbeddedGame.Prepare());
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            bool shortcut = DesktopShortcut.Ensure(desktop, root, Path.Combine(AppDirectory, "app"));
            message = shortcut ? "Гра готова. Ярлик WebPuzzle на робочому столі."
                : "Гра готова. Не вдалося додати ярлик на робочий стіл.";
        }
        catch (Exception error)
        {
            if (!(error is IOException || error is UnauthorizedAccessException || error is InvalidDataException)) throw;
            message = "Не вдалося підготувати гру. Перевірте вільне місце та повторіть запуск.";
        }
        busy = false;
        if (!IsDisposed) SetState(message);
    }
#endif

    private async Task StartGame()
    {
        var node = Path.Combine(root, @"runtime\node.exe");
        var script = Path.Combine(root, @"scripts\start.mjs");
        if (!File.Exists(node) || !File.Exists(script))
        {
            SetState("Розпакуйте всю папку WebPuzzle з архіву.");
            return;
        }

        ready = false;
        busy = true;
        SetState("Запускаємо гру…");
        var start = new ProcessStartInfo(node, "scripts\\start.mjs") {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        start.EnvironmentVariables["WEBPUZZLE_MANAGED"] = "1";
        try
        {
            var process = Process.Start(start);
            server = process;
            var errors = process.StandardError.ReadToEndAsync();
            var timeout = Task.Delay(TimeSpan.FromSeconds(12));
            while (server == process)
            {
                var next = process.StandardOutput.ReadLineAsync();
                if (await Task.WhenAny(next, timeout) == timeout)
                    throw new InvalidOperationException("Запуск триває надто довго. Спробуйте ще раз.");
                var line = await next;
                if (line == null)
                {
                    var message = (await errors).Trim();
                    throw new InvalidOperationException(message.StartsWith("Не вдалося") ?
                        message.Substring(message.IndexOf('\n') + 1).Trim() : "Не вдалося запустити гру.");
                }
                if (line == "WEBPUZZLE_READY")
                {
                    ready = true;
                    busy = false;
                    SetState("Гра запущена. Залиште це вікно відкритим.");
                    OpenGame();
                    await WatchServer(process);
                    return;
                }
                if (line == "WEBPUZZLE_REUSED")
                {
                    StopServer();
                    ready = true;
                    busy = false;
                    SetState("Гра вже працює в іншому вікні.");
                    OpenGame();
                    return;
                }
            }
        }
        catch (Exception error)
        {
            if (IsDisposed) return;
            StopServer();
            SetState(error is InvalidOperationException ? error.Message : "Перевірте, чи розпаковано всі файли гри.");
        }
    }

    private async Task WatchServer(Process process)
    {
        try { await process.StandardOutput.ReadToEndAsync(); }
        catch (ObjectDisposedException) { return; }
        if (server != process || IsDisposed) return;
        StopServer();
        SetState("Гру зупинено. Можна запустити її знову.");
    }

    private void OpenGame()
    {
        // The package smoke test opens its own browser.
        if (Environment.GetEnvironmentVariable("WEBPUZZLE_NO_BROWSER") == "1") return;
        try { Process.Start(new ProcessStartInfo(address) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception) { SetState("Відкрийте в браузері " + address); }
    }

    private void StopServer()
    {
        var process = server;
        server = null;
        ready = false;
        busy = false;
        if (process == null) return;
        using (process)
        {
            try { process.StandardInput.Close(); }
            catch (IOException) { }
            if (process.WaitForExit(3500)) return;
            try { process.Kill(); }
            catch (InvalidOperationException) { }
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        base.OnFormClosing(e);
        if (!e.Cancel) StopServer();
    }
}
