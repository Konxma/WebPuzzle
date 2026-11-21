using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal sealed partial class WebPuzzleLauncher : Form
{
    private static readonly string AppDirectory = Path.Combine(
        Environment.GetEnvironmentVariable("LOCALAPPDATA") ??
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WebPuzzle");
    private readonly LauncherArtwork artwork = new LauncherArtwork(AppDirectory);
    private readonly PictureBox banner = new PictureBox { SizeMode = PictureBoxSizeMode.StretchImage };
    private readonly LauncherButton choosePhoto = new LauncherButton();
    private readonly LauncherButton resetPhoto = new LauncherButton();
    private readonly Panel titleBar = new Panel();
    private readonly Label themeLabel = new Label { Text = "Тема", TextAlign = ContentAlignment.MiddleLeft };
    private readonly RadioButton systemTheme = new RadioButton { Appearance = Appearance.Button, Text = "Системна" };
    private readonly RadioButton lightTheme = new RadioButton { Appearance = Appearance.Button, Text = "Світла" };
    private readonly RadioButton darkTheme = new RadioButton { Appearance = Appearance.Button, Text = "Темна" };
    private readonly Button minimize = new LauncherButton();
    private readonly Button close = new LauncherButton();
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
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
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
        themeLabel.SetBounds(14, 5, 44, 30);
        systemTheme.SetBounds(58, 5, 88, 30);
        lightTheme.SetBounds(148, 5, 65, 30);
        darkTheme.SetBounds(215, 5, 65, 30);
        systemTheme.AccessibleName = "Системна тема";
        systemTheme.AccessibleDescription = "Використовує тему програм Windows";
        systemTheme.TextAlign = ContentAlignment.MiddleCenter;
        systemTheme.CheckedChanged += (sender, args) => { if (systemTheme.Checked) ChangeTheme(ThemeMode.System); };
        lightTheme.AccessibleName = "Світла тема";
        darkTheme.AccessibleName = "Темна тема";
        lightTheme.TextAlign = ContentAlignment.MiddleCenter;
        darkTheme.TextAlign = ContentAlignment.MiddleCenter;
        lightTheme.CheckedChanged += (sender, args) => { if (lightTheme.Checked) ChangeTheme(ThemeMode.Light); };
        darkTheme.CheckedChanged += (sender, args) => { if (darkTheme.Checked) ChangeTheme(ThemeMode.Dark); };
        minimize.SetBounds(348, 2, 40, 36);
        minimize.Text = "−";
        minimize.AccessibleName = "Згорнути вікно";
        minimize.Click += (sender, args) => WindowState = FormWindowState.Minimized;
        close.SetBounds(390, 2, 40, 36);
        close.Text = "×";
        close.AccessibleName = "Закрити лаунчер";
        close.Click += (sender, args) => Close();
        titleBar.Controls.AddRange(new Control[] { themeLabel, systemTheme, lightTheme, darkTheme, minimize, close });

        banner.SetBounds(1, 41, 432, 164);
        banner.Disposed += (sender, args) => { if (banner.Image != null) banner.Image.Dispose(); };
        choosePhoto.SetBounds(206, 228, 114, 32);
        choosePhoto.Text = "Змінити фото";
        choosePhoto.Click += (sender, args) => PickPhoto();
        resetPhoto.SetBounds(327, 228, 82, 32);
        resetPhoto.Text = "Скинути";
        resetPhoto.AccessibleName = "Повернути «Тиху затоку»";
        resetPhoto.Click += (sender, args) => EditArtwork(() => artwork.Reset(), "Тиху затоку відновлено.");
        RefreshBanner();
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
        Controls.AddRange(new Control[] { titleBar, banner, title, choosePhoto, resetPhoto, statusDot, status, play, stop });
        AcceptButton = play;
        themeMode = LoadTheme();
        dark = ResolveDarkTheme();
        themeInitialized = true;
        ApplyTheme();
        Activated += (sender, args) => RefreshSystemTheme();
#if EMBEDDED_PACKAGE
        busy = true;
        SetState("Готуємо файли гри…");
        Shown += async (sender, args) => await PrepareGame();
#else
        SetState("Гра готова до запуску.");
#endif
    }

    private void RefreshBanner()
    {
        var previous = banner.Image;
        bool custom;
        banner.Image = artwork.Banner(out custom);
        if (previous != null) previous.Dispose();
        resetPhoto.Visible = custom;
        choosePhoto.Left = custom ? 206 : 295;
    }

    private void PickPhoto()
    {
        using (var dialog = new OpenFileDialog {
            Title = "Зображення для пазла", Filter = "Зображення JPG і PNG|*.jpg;*.jpeg;*.png"
        })
        {
            if (dialog.ShowDialog(this) == DialogResult.OK)
                EditArtwork(() => artwork.Choose(dialog.FileName), "Фото вибрано. Воно з’явиться в браузері.");
        }
    }

    private void EditArtwork(Action edit, string message)
    {
        try
        {
            edit();
            RefreshBanner();
            SetState(ready ? message + " Оновіть сторінку гри." : message);
        }
        catch (Exception error)
        {
            if (!(error is IOException || error is ArgumentException || error is InvalidDataException ||
                error is UnauthorizedAccessException || error is ExternalException)) throw;
            SetState("Не вдалося змінити фото. Виберіть інше JPG або PNG до 25 МБ.");
        }
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

    private void SetState(string message)
    {
        status.Text = message;
        statusDot.Invalidate();
        play.BackColor = PlayColor();
        play.Text = ready ? "Відкрити гру" : "Грати";
        play.Enabled = !busy;
        choosePhoto.Enabled = !busy;
        resetPhoto.Enabled = !busy;
        stop.Enabled = !busy && ready && server != null;
    }

}
