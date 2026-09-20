param([string]$Archive = "")
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content (Join-Path $PSScriptRoot 'native-runtime-manifest.json') -Raw | ConvertFrom-Json
$valid = $true
foreach ($item in $manifest.artifacts) {
  $path = Join-Path $repoRoot $item.path
  if (!(Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $item.sha256) { $valid = $false }
}
if ($valid) { Write-Output 'Native runtime already verified.'; exit 0 }
$cache = Join-Path $repoRoot '.test-artifacts/runtime-download'
New-Item -ItemType Directory -Force $cache | Out-Null
if (!$Archive) {
  $Archive = Join-Path $cache 'native-runtime.zip'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/neura-neura/subscreen/releases/download/v0.3.0/native-runtime-windows-x64.zip' -OutFile $Archive
}
Expand-Archive -LiteralPath $Archive -DestinationPath $cache -Force
foreach ($item in $manifest.artifacts) {
  $source = Join-Path $cache $item.path
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $item.sha256) { throw "Runtime checksum mismatch: $($item.path)" }
  $destination = Join-Path $repoRoot $item.path
  New-Item -ItemType Directory -Force (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
}
Write-Output 'Native runtime installed and verified.'
