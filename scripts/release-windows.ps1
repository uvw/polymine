<#
.SYNOPSIS
  Builds the Windows release files on this machine, to test them.

.DESCRIPTION
  Makes the same files the release workflow makes on Windows: the NSIS
  installer with polymine-cli bundled, and the portable ZIP. With -Tag it
  first checks that the tag matches every version, and with -InstallerTest it
  runs scripts/windows-installer-test.ps1, which resets and restores the
  player's data.

  It publishes nothing. Releases come from the release workflow
  (docs/releasing.md): a local build records this machine's home folder in the
  binaries, and nothing attests it.

.EXAMPLE
  pwsh scripts/release-windows.ps1
  pwsh scripts/release-windows.ps1 -Tag v0.0.3 -InstallerTest
#>
param(
  [string]$Tag,
  [switch]$InstallerTest
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Run($what, [scriptblock]$command) {
  Write-Host "==> $what"
  & $command
  if ($LASTEXITCODE -ne 0) { throw "$what failed with exit code $LASTEXITCODE" }
}

if ($Tag) {
  Run "Check that $Tag matches every version" { node scripts/check-versions.mjs $Tag }
} else {
  Run "Check that every version matches" { node scripts/check-versions.mjs }
}
$dirty = git status --porcelain --untracked-files=no
if ($dirty) { Write-Warning "The working tree has uncommitted changes; the build will include them." }

$target = "x86_64-pc-windows-msvc"
Run "Build polymine-cli for the bundle" { cargo build --release --locked -p polymine-cli }
New-Item -ItemType Directory -Force "src-tauri/binaries" | Out-Null
Copy-Item "target/release/polymine-cli.exe" "src-tauri/binaries/polymine-cli-$target.exe" -Force

Run "Build the app and its installers" {
  npx tauri build --config src-tauri/tauri.bundle-cli.conf.json
}

$version = (Get-Content src-tauri/tauri.conf.json | ConvertFrom-Json).version
$bundle = "target/release/bundle"
$installers = @(
  Get-ChildItem "$bundle/nsis/Polymine_${version}_x64-setup.exe"
)

$stage = Join-Path ([IO.Path]::GetTempPath()) "polymine-portable-$version"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
$folder = New-Item -ItemType Directory -Path "$stage/Polymine"
Copy-Item "target/release/polymine.exe" "$folder/Polymine.exe"
Copy-Item "target/release/polymine-cli.exe" "$folder/polymine-cli.exe"
Set-Content "$folder/portable" "Polymine keeps its settings, games and logs in the data folder here."
$zip = Join-Path $repo "$bundle/Polymine_${version}_x64_portable.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $folder -DestinationPath $zip
Remove-Item -Recurse -Force $stage

$files = @($installers | ForEach-Object { $_.FullName }) + $zip
Write-Host "==> Built"
$files | ForEach-Object { Write-Host "    $_  ($([math]::Round((Get-Item $_).Length / 1MB, 1)) MB)" }

if ($InstallerTest) {
  Run "Test the installer" {
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-installer-test.ps1 -ResetPlayerData -Setup $installers[0].FullName
  }
}
