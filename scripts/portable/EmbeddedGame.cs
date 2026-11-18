using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;

internal static class EmbeddedGame
{
    private const string ResourcePrefix = "WebPuzzle.Package.";

    internal static string Prepare()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resource = Array.Find(assembly.GetManifestResourceNames(),
            name => name.StartsWith(ResourcePrefix, StringComparison.Ordinal));
        if (resource == null) throw new InvalidDataException("Embedded game is missing.");

        var localData = Environment.GetEnvironmentVariable("LOCALAPPDATA") ??
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var cache = Path.Combine(localData, "WebPuzzle", "app");
        var version = Path.Combine(cache, resource.Substring(ResourcePrefix.Length));
        var game = Path.Combine(version, "WebPuzzle");
        if (IsReady(game)) return game;

        Directory.CreateDirectory(cache);
        var stage = Path.Combine(cache, "extract-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(stage);
        try
        {
            using (var stream = assembly.GetManifestResourceStream(resource))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
                archive.ExtractToDirectory(stage);

            if (!IsReady(Path.Combine(stage, "WebPuzzle"))) throw new InvalidDataException("Incomplete game.");
            try { Directory.Move(stage, version); }
            catch (IOException)
            {
                if (!IsReady(game)) throw;
            }
            return game;
        }
        finally
        {
            if (Directory.Exists(stage)) Directory.Delete(stage, true);
        }
    }

    private static bool IsReady(string game)
    {
        return File.Exists(Path.Combine(game, @"runtime\node.exe")) &&
            File.Exists(Path.Combine(game, @"scripts\start.mjs")) &&
            File.Exists(Path.Combine(game, @"apps\server\dist\main.js")) &&
            File.Exists(Path.Combine(game, @"client\index.html"));
    }
}
