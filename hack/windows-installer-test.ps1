<#
.SYNOPSIS
  Tests the NSIS installer's install, uninstall, and update paths on Windows.

.DESCRIPTION
  Uninstalls Polymine and deletes its data folders on purpose, so it refuses
  to run without -ResetPlayerData. It backs up %APPDATA%\Polymine, both
  dev.uvw.polymine folders, and the user's PATH first and restores them at
  the end, whatever the outcome, then leaves the tested build installed.

  Build the installer with polymine-cli bundled first; docs/windows.md has
  the commands. The checks:
    1. A silent install, a start, and a clean quit leave settings.json and
       window.json in %APPDATA%\Polymine, and put the install folder on the
       user's PATH.
    2. Uninstalling with "Delete the application data" unticked keeps the
       data and takes the folder off PATH.
    3. Uninstalling with it ticked removes %APPDATA%\Polymine (the hook in
       src-tauri/windows/hooks.nsh) and both dev.uvw.polymine folders
       (Tauri's own step).
    4. The uninstall an update runs (/UPDATE) keeps the data and the PATH
       entry.

  The uninstaller only reads the checkbox from its dialog, so check 3 ticks it
  and presses Uninstall through Win32 messages. That works over Remote Desktop
  too, where UI Automation sees the NSIS controls but can't press them.

.EXAMPLE
  # Build the installer with polymine-cli bundled, as docs/windows.md shows.
  pwsh hack/windows-installer-test.ps1 -ResetPlayerData
#>
param(
  [switch]$ResetPlayerData,
  [string]$Setup = ""
)

$ErrorActionPreference = "Stop"
if (-not $ResetPlayerData) {
  throw "This uninstalls Polymine and deletes its data, then restores a backup. Pass -ResetPlayerData to run it."
}

$repo = Split-Path -Parent $PSScriptRoot
if (-not $Setup) {
  $Setup = Get-ChildItem "$repo\target\release\bundle\nsis\*-setup.exe" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Setup -or -not (Test-Path $Setup)) { throw "No NSIS installer; run npx tauri build --bundles nsis first." }

$installDir = "$env:LOCALAPPDATA\Polymine"
$data = "$env:APPDATA\Polymine"
$legacyRoaming = "$env:APPDATA\dev.uvw.polymine"
$legacyLocal = "$env:LOCALAPPDATA\dev.uvw.polymine"
$folders = @($data, $legacyRoaming, $legacyLocal)
$cli = "$repo\target\debug\polymine-cli.exe"
$failures = 0

# The user's PATH as stored, unexpanded, with its registry type.
function Get-UserPath() {
  $key = Get-Item HKCU:\Environment
  $value = $key.GetValue("Path", $null, "DoNotExpandEnvironmentNames")
  if ($null -eq $value) { return $null }
  return @{ Value = $value; Kind = $key.GetValueKind("Path") }
}

function On-UserPath() {
  $now = Get-UserPath
  if (-not $now) { return $false }
  return [bool]($now.Value -split ";" | Where-Object { $_.TrimEnd("\") -ieq $installDir })
}

function Check($name, [bool]$ok) {
  if ($ok) { Write-Host "PASS  $name" } else { Write-Host "FAIL  $name"; $script:failures++ }
}

function Install() { Start-Process -FilePath $Setup -ArgumentList "/S" -Wait }

function Uninstall([string[]]$flags) {
  # _?= runs the uninstaller in place and makes Start-Process wait for it.
  Start-Process -FilePath "$installDir\uninstall.exe" -ArgumentList ($flags + "_?=$installDir") -Wait
}

function Stop-Polymine() {
  Get-Process polymine -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$installDir*" } |
    ForEach-Object { [void]$_.CloseMainWindow() }
  Start-Sleep -Seconds 3
}

# Starts the installed app, leaves a game in progress when the CLI is built,
# and quits through the window so the app saves on its way out.
function Play() {
  Start-Process -FilePath "$installDir\polymine.exe"
  Start-Sleep -Seconds 10
  if (Test-Path $cli) {
    & $cli new --tiling square --level beginner | Out-Null
    & $cli open 40 | Out-Null
    Start-Sleep -Seconds 6
  }
  Stop-Polymine
}

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NsisDialog {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
  const uint WM_COMMAND = 0x0111, BM_GETCHECK = 0x00F0, BM_CLICK = 0x00F5;

  // Button labels carry "&" accelerators, as in "&Uninstall".
  public static IntPtr Child(IntPtr parent, string text) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(parent, (h, l) => {
      var s = new StringBuilder(512);
      GetWindowText(h, s, 512);
      if (s.ToString().Replace("&", "").Trim() == text) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static bool Tick(IntPtr box) {
    if (SendMessage(box, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero) == IntPtr.Zero)
      SendMessage(box, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
    return SendMessage(box, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero) != IntPtr.Zero;
  }
  // The command a click sends, which works without the window in front.
  public static void Press(IntPtr dialog, IntPtr button) {
    SendMessage(dialog, WM_COMMAND, (IntPtr)GetDlgCtrlID(button), button);
  }
}
"@

function Uninstall-DeletingData() {
  $proc = Start-Process -FilePath "$installDir\uninstall.exe" -ArgumentList "_?=$installDir" -PassThru
  $dialog = [IntPtr]::Zero
  for ($i = 0; $i -lt 40 -and $dialog -eq [IntPtr]::Zero; $i++) {
    Start-Sleep -Milliseconds 250
    $dialog = [NsisDialog]::FindWindow("#32770", "Polymine Uninstall ")
  }
  if ($dialog -eq [IntPtr]::Zero) { throw "The uninstaller's window never appeared." }
  $box = [NsisDialog]::Child($dialog, "Delete the application data")
  if ($box -eq [IntPtr]::Zero) { throw "The uninstaller has no delete-data checkbox." }
  Check "the delete-data box can be ticked" ([NsisDialog]::Tick($box))
  [NsisDialog]::Press($dialog, [NsisDialog]::Child($dialog, "Uninstall"))
  for ($i = 0; $i -lt 60 -and -not $proc.HasExited; $i++) {
    Start-Sleep -Milliseconds 500
    foreach ($label in @("Finish", "Close")) {
      $done = [NsisDialog]::Child($dialog, $label)
      if ($done -ne [IntPtr]::Zero) { [NsisDialog]::Press($dialog, $done) }
    }
    $proc.Refresh()
  }
  Check "the uninstaller finished" $proc.HasExited
}

$backup = Join-Path $env:TEMP ("polymine-installer-test-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backup | Out-Null
Write-Host "Installer: $Setup"
Write-Host "Backup:    $backup"
Stop-Polymine
$savedPath = Get-UserPath
$saved = @{}
foreach ($folder in $folders) {
  $saved[$folder] = Join-Path $backup ($folder -replace '[:\\]', '_')
  if (Test-Path $folder) { Copy-Item -Recurse -Force $folder $saved[$folder] }
}

try {
  Install
  $bundled = Test-Path "$installDir\polymine-cli.exe"
  Check "the installer bundles polymine-cli" $bundled
  if ($bundled) { Check "the install folder is on the user's PATH" (On-UserPath) }
  Play
  Check "settings.json after a start" (Test-Path "$data\settings.json")
  Check "window.json after a clean quit" (Test-Path "$data\window.json")
  if (Test-Path $cli) { Check "game.json for the unfinished game" (Test-Path "$data\game.json") }

  Uninstall @("/S")
  Check "the app is gone after an uninstall" (-not (Test-Path "$installDir\polymine.exe"))
  Check "data kept when the box is unticked" (Test-Path "$data\settings.json")
  if ($bundled) { Check "the install folder is off PATH after an uninstall" (-not (On-UserPath)) }

  Install
  Uninstall-DeletingData
  Check "%APPDATA%\Polymine removed when ticked" (-not (Test-Path $data))
  Check "%APPDATA%\dev.uvw.polymine removed when ticked" (-not (Test-Path $legacyRoaming))
  Check "%LOCALAPPDATA%\dev.uvw.polymine removed when ticked" (-not (Test-Path $legacyLocal))

  Install
  Play
  Uninstall @("/UPDATE", "/S")
  Check "data kept through an update's uninstall" (Test-Path "$data\settings.json")
  if ($bundled) { Check "the PATH entry kept through an update's uninstall" (On-UserPath) }
}
finally {
  Stop-Polymine
  if ($savedPath) {
    Set-ItemProperty HKCU:\Environment -Name Path -Value $savedPath.Value -Type $savedPath.Kind
  }
  foreach ($folder in $folders) {
    if (Test-Path $folder) { Remove-Item -Recurse -Force $folder }
    if (Test-Path $saved[$folder]) { Copy-Item -Recurse -Force $saved[$folder] $folder }
  }
  Install
  Write-Host "Restored the data and the PATH from before, and left the tested build installed."
}

if ($failures -gt 0) { Write-Host "$failures check(s) failed"; exit 1 }
Write-Host "All installer checks passed"
