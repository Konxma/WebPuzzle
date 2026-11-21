param(
  [Parameter(Mandatory)] [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$output = (New-Item -ItemType Directory -Force -Path $OutputDirectory).FullName
$archive = Join-Path $output 'WebPuzzle-Windows-x64.zip'
$exe = Join-Path $output 'WebPuzzle.exe'
if (Test-Path -LiteralPath $archive) { throw "An archive already exists at $archive." }
if (Test-Path -LiteralPath $exe) { throw "A launcher already exists at $exe." }

$temp = Join-Path ([IO.Path]::GetTempPath()) ('webpuzzle-package-' + [guid]::NewGuid())
$stage = Join-Path $temp 'WebPuzzle'
$zipName = 'node-v22.23.3-win-x64.zip'
$nodeUrl = "https://nodejs.org/dist/v22.23.3/$zipName"
$nodeSha = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71'
New-Item -ItemType Directory -Path $temp | Out-Null

Push-Location $project
try {
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'WebPuzzle build failed.' }

  foreach ($dir in @('apps/client','apps/server','packages/shared','client','runtime','scripts','licenses')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stage $dir) | Out-Null
  }
  foreach ($file in @('package.json','package-lock.json','apps/client/package.json','apps/server/package.json','packages/shared/package.json')) {
    Copy-Item -LiteralPath (Join-Path $project $file) -Destination (Join-Path $stage $file)
  }

  Push-Location $stage
  try {
    npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace apps/server --workspace packages/shared
    if ($LASTEXITCODE -ne 0) { throw 'Installing the portable server dependencies failed.' }
  } finally { Pop-Location }

  Copy-Item -LiteralPath (Join-Path $project 'apps/server/dist') -Destination (Join-Path $stage 'apps/server') -Recurse
  $scope = Join-Path $stage 'node_modules/@web-pazle'
  foreach ($name in @('client','server','shared')) {
    $path = Join-Path $scope $name
    $entry = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    if ($entry) {
      if ($entry.LinkType -ne 'Junction') { throw "Unexpected workspace entry $path." }
      [IO.Directory]::Delete($path, $false)
    }
  }
  $shared = (New-Item -ItemType Directory -Force -Path (Join-Path $scope 'shared')).FullName
  Copy-Item -LiteralPath (Join-Path $project 'packages/shared/package.json') -Destination $shared
  Copy-Item -LiteralPath (Join-Path $project 'packages/shared/dist') -Destination $shared -Recurse
  Copy-Item -Path (Join-Path $project 'apps/client/dist/*') -Destination (Join-Path $stage 'client') -Recurse
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'portable/start.mjs') -Destination (Join-Path $stage 'scripts')

  # Decode the names from the portable source files regardless of the PowerShell edition's source encoding.
  $guide = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'portable') -Filter '*.txt' | Select-Object -First 1
  Copy-Item -LiteralPath $guide.FullName -Destination $stage
  $launcherName = -join (1047,1072,1087,1091,1089,1090,1080,1090,1080 | ForEach-Object { [char]$_ })
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'portable/Start.cmd') -Destination (Join-Path $stage "$launcherName WebPuzzle.cmd")

  $nodeZip = Join-Path $temp $zipName
  Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip -TimeoutSec 120
  if ((Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash -ne $nodeSha) {
    throw 'SHA-256 of the Node.js distribution does not match.'
  }
  Expand-Archive -LiteralPath $nodeZip -DestinationPath $temp
  $node = Join-Path $temp 'node-v22.23.3-win-x64'
  Copy-Item -LiteralPath (Join-Path $node 'node.exe') -Destination (Join-Path $stage 'runtime')
  Copy-Item -LiteralPath (Join-Path $node 'LICENSE') -Destination (Join-Path $stage 'licenses/Node.js.txt')
  foreach ($name in @('react','react-dom','pixi.js','qrcode.react','@colyseus/sdk','@gentleface/react')) {
    $folder = Join-Path $project "node_modules/$name"
    $license = Get-ChildItem -LiteralPath $folder -File | Where-Object { $_.Name -match '^licen[sc]e' } | Select-Object -First 1
    if ($license) {
      $licenseName = $name.Replace('@','').Replace('/','-') + '.txt'
      Copy-Item -LiteralPath $license.FullName -Destination (Join-Path $stage "licenses/$licenseName")
    }
  }

  $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
  $icon = Join-Path $PSScriptRoot 'portable/WebPuzzle.ico'
  $banner = Join-Path $PSScriptRoot 'portable/quiet-bay-banner.png'
  $launcherSources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'portable') -Filter 'WebPuzzleLauncher*.cs' -File |
    Sort-Object Name | ForEach-Object FullName)
  & $compiler /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/win32icon:$icon" "/resource:$banner,WebPuzzle.Banner" "/out:$stage/WebPuzzle.exe" @launcherSources (Join-Path $PSScriptRoot 'portable/LauncherArtwork.cs')
  if ($LASTEXITCODE -ne 0) { throw 'Windows launcher build failed.' }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive, [IO.Compression.CompressionLevel]::Optimal, $true, [Text.Encoding]::UTF8)
  & (Join-Path $PSScriptRoot 'build-standalone.ps1') -ArchivePath $archive -OutputPath $exe | Out-Null
  Get-Item -LiteralPath $archive,$exe | Select-Object FullName,Length
} finally {
  Pop-Location
  $resolvedTemp = (Resolve-Path -LiteralPath $temp).Path
  if ($resolvedTemp -eq $temp -and (Split-Path -Leaf $resolvedTemp) -like 'webpuzzle-package-*') {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
