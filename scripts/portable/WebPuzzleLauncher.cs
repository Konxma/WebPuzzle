using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed class WebPuzzleLauncher : Form
{
#if EMBEDDED_PACKAGE
    private string root;
#else
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
#endif
    private readonly string address = "http://localhost:" +
        (Environment.GetEnvironmentVariable("WEBPUZZLE_PORT") ?? "5174") + "/";
    private readonly string themePath = Path.Combine(
        Environment.GetEnvironmentVariable("LOCALAPPDATA") ??
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WebPuzzle", "launcher-theme");
    private readonly Panel titleBar = new Panel();
    private readonly Button theme = new LauncherButton();
    private readonly Button minimize = new LauncherButton();
    private readonly Button close = new LauncherButton();
    private bool dark;
    private readonly Panel statusDot = new Panel();
    private readonly Label status = new Label();
    private readonly LauncherButton play = new LauncherButton();
    private readonly LauncherButton stop = new LauncherButton();
    private sealed class LauncherButton : Button
    {
        internal Color DisabledColor { get; set; }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Enabled || SystemInformation.HighContrast)
            {
                base.OnPaint(e);
                return;
            }

            e.Graphics.Clear(BackColor);
            using (var pen = new Pen(FlatAppearance.BorderColor))
                e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
            TextRenderer.DrawText(e.Graphics, Text, Font, ClientRectangle, DisabledColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }
    }

    private Process server;
    private bool ready;
    private bool busy;

    private const int NonClientLeftButtonDown = 0x00A1;
    private static readonly IntPtr CaptionArea = new IntPtr(2);
    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();
    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new WebPuzzleLauncher());
    }

    private WebPuzzleLauncher()
    {
        Text = "WebPuzzle";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.None;
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96, 96);
        ClientSize = new Size(434, 394);
        Font = new Font("Segoe UI", 10);

        titleBar.SetBounds(1, 1, 432, 40);
        titleBar.MouseDown += (sender, args) => {
            if (args.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(Handle, NonClientLeftButtonDown, CaptionArea, IntPtr.Zero);
        };
        theme.SetBounds(12, 4, 120, 32);
        theme.Click += (sender, args) => {
            dark = !dark;
            ApplyTheme();
            SaveTheme();
        };
        minimize.SetBounds(348, 2, 40, 36);
        minimize.Text = "−";
        minimize.AccessibleName = "Згорнути вікно";
        minimize.Click += (sender, args) => WindowState = FormWindowState.Minimized;
        close.SetBounds(390, 2, 40, 36);
        close.Text = "×";
        close.AccessibleName = "Закрити лаунчер";
        close.Click += (sender, args) => Close();
        titleBar.Controls.AddRange(new Control[] { theme, minimize, close });

        var banner = CreateBanner();
        banner.SetBounds(1, 41, 432, 164);
        var title = new Label {
            Text = "WebPuzzle", AutoSize = true, Location = new Point(23, 221),
            Font = new Font(Font.FontFamily, 23, FontStyle.Bold)
        };
        statusDot.SetBounds(25, 276, 8, 8);
        statusDot.Paint += (sender, args) => {
            args.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            var color = ready ? statusDot.ForeColor : status.ForeColor;
            if (busy) color = dark ? Color.FromArgb(216, 189, 145) : Color.FromArgb(145, 92, 47);
            using (var brush = new SolidBrush(color))
                args.Graphics.FillEllipse(brush, statusDot.ClientRectangle);
        };
        status.SetBounds(41, 268, 368, 44);
        status.AccessibleName = "Стан гри";

        play.SetBounds(25, 325, 186, 44);
        stop.SetBounds(223, 325, 186, 44);
        play.TabIndex = 0;
        stop.TabIndex = 1;
        titleBar.TabIndex = 2;
        stop.Text = "Зупинити гру";
        play.Click += async (sender, args) => {
#if EMBEDDED_PACKAGE
            if (root == null) await PrepareGame();
            if (root == null || IsDisposed) return;
#endif
            if (ready && server != null) OpenGame();
            else await StartGame();
        };
        stop.Click += (sender, args) => {
            StopServer();
            SetState("Гру зупинено.");
        };
        Controls.AddRange(new Control[] { titleBar, banner, title, statusDot, status, play, stop });
        AcceptButton = play;
        dark = LoadTheme();
        ApplyTheme();
#if EMBEDDED_PACKAGE
        busy = true;
        SetState("Готуємо файли гри…");
        Shown += async (sender, args) => await PrepareGame();
#else
        SetState("Гра готова до запуску.");
#endif
    }

#if EMBEDDED_PACKAGE
    private async Task PrepareGame()
    {
        busy = true;
        SetState("Готуємо файли гри…");
        string message;
        try
        {
            root = await Task.Run(() => EmbeddedGame.Prepare());
            message = "Гра готова до запуску.";
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

    private static PictureBox CreateBanner()
    {
        var banner = new PictureBox { SizeMode = PictureBoxSizeMode.StretchImage };
        Bitmap bitmap;
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("WebPuzzle.Banner"))
        using (var image = Image.FromStream(stream))
            bitmap = new Bitmap(image);
        banner.Image = bitmap;
        banner.Disposed += (sender, args) => bitmap.Dispose();
        return banner;
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var parameters = base.CreateParams;
            parameters.Style |= 0x00080000 | 0x00020000; // WS_SYSMENU | WS_MINIMIZEBOX
            return parameters;
        }
    }

    private bool LoadTheme()
    {
        try { return File.Exists(themePath) && File.ReadAllText(themePath) == "dark"; }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    private void SaveTheme()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(themePath));
            File.WriteAllText(themePath, dark ? "dark" : "light");
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private Color PlayColor()
    {
        if (dark) return busy ? Color.FromArgb(69, 78, 67) : Color.FromArgb(187, 213, 189);
        return busy ? Color.FromArgb(230, 235, 227) : Color.FromArgb(40, 78, 62);
    }

    private void ApplyTheme()
    {
        var surface = dark ? Color.FromArgb(32, 33, 30) : Color.FromArgb(250, 249, 245);
        var chrome = dark ? Color.FromArgb(27, 29, 25) : Color.FromArgb(238, 239, 231);
        var text = dark ? Color.FromArgb(242, 239, 231) : Color.FromArgb(36, 57, 47);
        var muted = dark ? Color.FromArgb(188, 190, 178) : Color.FromArgb(88, 98, 89);
        var border = dark ? Color.FromArgb(85, 90, 79) : Color.FromArgb(191, 198, 184);
        var hover = dark ? Color.FromArgb(52, 55, 47) : Color.FromArgb(223, 227, 215);

        BackColor = surface;
        ForeColor = text;
        titleBar.BackColor = chrome;
        status.ForeColor = muted;
        statusDot.ForeColor = dark ? Color.FromArgb(187, 213, 189) : Color.FromArgb(40, 78, 62);
        theme.Text = dark ? "Світла тема" : "Темна тема";
        foreach (var button in new[] { theme, minimize, close })
        {
            ConfigureButton(button, chrome, text, hover, border);
            button.FlatAppearance.BorderSize = 0;
        }
        close.FlatAppearance.MouseOverBackColor = dark ? Color.FromArgb(100, 58, 51) : Color.FromArgb(235, 215, 206);
        ConfigureButton(play, PlayColor(), dark ? Color.FromArgb(26, 40, 29) : Color.White,
            dark ? Color.FromArgb(210, 230, 211) : Color.FromArgb(52, 95, 77), border);
        ConfigureButton(stop, surface, text, hover, border);
        play.DisabledColor = muted;
        stop.DisabledColor = muted;
        statusDot.Invalidate();
    }

    private static void ConfigureButton(Button button, Color background, Color foreground, Color hover, Color border)
    {
        button.FlatStyle = FlatStyle.Flat;
        button.UseVisualStyleBackColor = false;
        button.BackColor = background;
        button.ForeColor = foreground;
        button.FlatAppearance.BorderColor = border;
        button.FlatAppearance.MouseOverBackColor = hover;
        button.FlatAppearance.MouseDownBackColor = hover;
    }

    private void SetState(string message)
    {
        status.Text = message;
        statusDot.Invalidate();
        play.BackColor = PlayColor();
        play.Text = ready ? "Відкрити гру" : "Грати";
        play.Enabled = !busy;
        stop.Enabled = !busy && ready && server != null;
    }

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
