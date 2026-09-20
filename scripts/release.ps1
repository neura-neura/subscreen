param([string]$SigningKey = (Join-Path $env:USERPROFILE '.tauri/subscreen.key'))
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $repoRoot
try {
  & (Join-Path $PSScriptRoot 'bootstrap-runtime.ps1')
  if (!(Test-Path -LiteralPath $SigningKey)) { throw 'Set -SigningKey to the private updater signing key.' }
  $env:TAURI_SIGNING_PRIVATE_KEY = $SigningKey
  & node -e "const {spawnSync}=require('node:child_process'); const result=spawnSync(process.execPath,['node_modules/@tauri-apps/cli/tauri.js','build','--bundles','nsis'],{stdio:'inherit',env:{...process.env,TAURI_SIGNING_PRIVATE_KEY_PASSWORD:process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD??''}});process.exit(result.status??1);"
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
  $installer = "Subscreen_${version}_x64-setup.exe"
  $directory = Join-Path $repoRoot 'src-tauri/target/release/bundle/nsis'
  $signature = (Get-Content (Join-Path $directory "$installer.sig") -Raw).Trim()
  $manifest = @{version=$version;notes="See release notes for v$version.";pub_date=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ');platforms=@{'windows-x86_64'=@{signature=$signature;url="https://github.com/neura-neura/subscreen/releases/download/v$version/$installer"}}}
  [IO.File]::WriteAllText((Join-Path $directory 'latest.json'),($manifest | ConvertTo-Json -Depth 5))
  Write-Output "Signed release artifacts: $directory"
} finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Pop-Location
}
