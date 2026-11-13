$ErrorActionPreference = 'Stop'
$nodePath = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js not found.' }
$rule = Get-NetFirewallRule -Name 'WebPazle-Home-LAN' -ErrorAction SilentlyContinue
if ($rule) { $rule | Remove-NetFirewallRule }
New-NetFirewallRule -Name 'WebPazle-Home-LAN' -DisplayName 'WebPuzzle Home LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5174 -RemoteAddress LocalSubnet -Profile Private,Public -Program $nodePath | Out-Null
Write-Host 'WebPuzzle: TCP 5174 allowed for the local subnet.'
