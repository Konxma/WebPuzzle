param(
  [Parameter(Mandatory)] [string] $ArchivePath,
  [Parameter(Mandatory)] [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
$archive = Get-Item -LiteralPath $ArchivePath
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
if (Test-Path -LiteralPath $output) { throw "A launcher already exists at $output." }

$hash = (Get-FileHash -LiteralPath $archive.FullName -Algorithm SHA256).Hash.Substring(0, 24).ToLowerInvariant()
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$launcherSources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'portable') -Filter 'WebPuzzleLauncher*.cs' -File |
    Sort-Object Name | ForEach-Object FullName)
$artwork = Join-Path $PSScriptRoot 'portable/LauncherArtwork.cs'
$embedded = Join-Path $PSScriptRoot 'portable/EmbeddedGame.cs'
$icon = Join-Path $PSScriptRoot 'portable/WebPuzzle.ico'
$banner = Join-Path $PSScriptRoot 'portable/quiet-bay-banner.png'
$arguments = @(
  '/nologo', '/codepage:65001', '/target:winexe', '/platform:x64', '/optimize+', '/define:EMBEDDED_PACKAGE',
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
  '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
  "/win32icon:$icon", "/resource:$banner,WebPuzzle.Banner", "/resource:$($archive.FullName),WebPuzzle.Package.$hash", "/out:$output", $embedded, $artwork, (Join-Path $PSScriptRoot 'portable/DesktopShortcut.cs')
) + $launcherSources
# Arguments are shared by all launcher partial classes.
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Standalone Windows launcher build failed.' }
Get-Item -LiteralPath $output
