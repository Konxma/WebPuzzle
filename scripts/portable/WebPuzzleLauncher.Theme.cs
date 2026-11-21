using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

internal sealed partial class WebPuzzleLauncher
{
    private readonly string themePath = Path.Combine(AppDirectory, "launcher-theme");
    private enum ThemeMode { System, Light, Dark }
    private ThemeMode themeMode;
    private bool themeInitialized;
    private bool dark;
    private const int SettingsChanged = 0x001A;
    private const int WindowsThemeChanged = 0x031A;

    protected override void WndProc(ref Message message)
    {
        base.WndProc(ref message);
        if (message.Msg == SettingsChanged || message.Msg == WindowsThemeChanged) RefreshSystemTheme();
    }

    private void RefreshSystemTheme()
    {
        if (!themeInitialized || IsDisposed || themeMode != ThemeMode.System) return;
        var systemDark = ResolveDarkTheme();
        if (systemDark == dark) return;
        dark = systemDark;
        ApplyTheme();
    }

    private bool ResolveDarkTheme()
    {
        if (themeMode != ThemeMode.System) return themeMode == ThemeMode.Dark;
        try
        {
            var preference = Registry.GetValue(
                @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                "AppsUseLightTheme", 1);
            return preference is int && (int)preference == 0;
        }
        catch (System.Security.SecurityException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
        catch (IOException) { return false; }
    }

    private void ChangeTheme(ThemeMode mode)
    {
        if (themeMode == mode) return;
        themeMode = mode;
        dark = ResolveDarkTheme();
        ApplyTheme();
        SaveTheme();
    }

    private ThemeMode LoadTheme()
    {
        try
        {
            if (File.Exists(themePath))
            {
                var saved = File.ReadAllText(themePath);
                if (saved == "dark") return ThemeMode.Dark;
                if (saved == "light") return ThemeMode.Light;
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        return ThemeMode.System;
    }

    private void SaveTheme()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(themePath));
            File.WriteAllText(themePath, themeMode.ToString().ToLowerInvariant());
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
        themeLabel.ForeColor = text;
        systemTheme.Checked = themeMode == ThemeMode.System;
        lightTheme.Checked = themeMode == ThemeMode.Light;
        darkTheme.Checked = themeMode == ThemeMode.Dark;
        var selected = dark ? Color.FromArgb(187, 213, 189) : Color.FromArgb(210, 225, 207);
        var selectedText = Color.FromArgb(32, 54, 44);
        foreach (var option in new[] { systemTheme, lightTheme, darkTheme })
        {
            ConfigureButton(option, chrome, option.Checked ? selectedText : text, option.Checked ? selected : hover, border);
            option.FlatAppearance.CheckedBackColor = selected;
        }
        foreach (var button in new[] { minimize, close })
        {
            ConfigureButton(button, chrome, text, hover, border);
            button.FlatAppearance.BorderSize = 0;
        }
        close.FlatAppearance.MouseOverBackColor = dark ? Color.FromArgb(100, 58, 51) : Color.FromArgb(235, 215, 206);
        ConfigureButton(play, PlayColor(), dark ? Color.FromArgb(26, 40, 29) : Color.White,
            dark ? Color.FromArgb(210, 230, 211) : Color.FromArgb(52, 95, 77), border);
        ConfigureButton(stop, surface, text, hover, border);
        ConfigureButton(choosePhoto, surface, text, hover, border);
        ConfigureButton(resetPhoto, surface, text, hover, border);
        play.DisabledColor = muted;
        stop.DisabledColor = muted;
        choosePhoto.DisabledColor = muted;
        resetPhoto.DisabledColor = muted;
        statusDot.Invalidate();
    }

    private static void ConfigureButton(ButtonBase button, Color background, Color foreground, Color hover, Color border)
    {
        button.FlatStyle = FlatStyle.Flat;
        button.UseVisualStyleBackColor = false;
        button.BackColor = background;
        button.ForeColor = foreground;
        button.FlatAppearance.BorderColor = border;
        button.FlatAppearance.MouseOverBackColor = hover;
        button.FlatAppearance.MouseDownBackColor = hover;
    }
}
