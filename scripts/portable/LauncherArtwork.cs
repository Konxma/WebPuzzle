using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Text;

internal sealed class LauncherArtwork
{
    private readonly string directory;
    private readonly string selection;

    internal LauncherArtwork(string appDirectory)
    {
        directory = Environment.GetEnvironmentVariable("WEBPAZLE_DATA_DIR") ?? Path.Combine(appDirectory, "data");
        selection = Path.Combine(directory, "launcher-photo");
    }

    internal Bitmap Banner(out bool custom)
    {
        custom = false;
        try
        {
            Guid id;
            if (File.Exists(selection) && Guid.TryParseExact(File.ReadAllText(selection), "D", out id))
            {
                using (var source = Image.FromFile(PhotoPath(id)))
                {
                    var preview = DrawFit(source, 864, 328, true);
                    custom = true;
                    return preview;
                }
            }
        }
        catch (Exception error)
        {
            if (!(error is IOException || error is ArgumentException || error is UnauthorizedAccessException)) throw;
        }
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("WebPuzzle.Banner"))
        using (var image = Image.FromStream(stream))
            return new Bitmap(image);
    }

    internal void Choose(string file)
    {
        if (new FileInfo(file).Length > 25 * 1024 * 1024) throw new InvalidDataException();
        var id = Guid.NewGuid();
        var photo = PhotoPath(id);
        using (var input = File.OpenRead(file))
        using (var image = Image.FromStream(input, false, true))
        {
            if ((!image.RawFormat.Equals(ImageFormat.Jpeg) && !image.RawFormat.Equals(ImageFormat.Png)) ||
                (long)image.Width * image.Height > 60000000) throw new InvalidDataException();
            Orient(image);
            var scale = Math.Min(1.0, Math.Min(3200.0 / image.Width, 2000.0 / image.Height));
            var width = Math.Max(1, (int)Math.Round(image.Width * scale));
            var height = Math.Max(1, (int)Math.Round(image.Height * scale));
            Directory.CreateDirectory(Path.GetDirectoryName(photo));
            using (var output = DrawFit(image, width, height, false))
                output.Save(photo, ImageFormat.Jpeg);
        }

        // Only publish the selection after the immutable image can be served by the game.
        var pending = selection + "." + id.ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(pending, id.ToString("D"), Encoding.ASCII);
            if (File.Exists(selection)) File.Replace(pending, selection, null);
            else File.Move(pending, selection);
        }
        finally { File.Delete(pending); }
    }

    internal void Reset() { File.Delete(selection); }

    private string PhotoPath(Guid id)
    {
        return Path.Combine(directory, "photos", id.ToString("D") + ".jpg");
    }

    private static void Orient(Image image)
    {
        const int orientation = 0x112;
        if (Array.IndexOf(image.PropertyIdList, orientation) < 0) return;
        var value = image.GetPropertyItem(orientation).Value;
        if (value.Length == 0) return;
        switch (value[0])
        {
            case 2: image.RotateFlip(RotateFlipType.RotateNoneFlipX); break;
            case 3: image.RotateFlip(RotateFlipType.Rotate180FlipNone); break;
            case 4: image.RotateFlip(RotateFlipType.Rotate180FlipX); break;
            case 5: image.RotateFlip(RotateFlipType.Rotate90FlipX); break;
            case 6: image.RotateFlip(RotateFlipType.Rotate90FlipNone); break;
            case 7: image.RotateFlip(RotateFlipType.Rotate270FlipX); break;
            case 8: image.RotateFlip(RotateFlipType.Rotate270FlipNone); break;
        }
    }

    private static Bitmap DrawFit(Image image, int width, int height, bool crop)
    {
        var bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.Clear(Color.FromArgb(250, 249, 245));
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            var scale = Math.Max((double)width / image.Width, (double)height / image.Height);
            var w = crop ? (float)(image.Width * scale) : width;
            var h = crop ? (float)(image.Height * scale) : height;
            graphics.DrawImage(image, (width - w) / 2, (height - h) / 2, w, h);
        }
        return bitmap;
    }
}
