$ErrorActionPreference = "Stop"
. "$PSScriptRoot\modules\Common.ps1"

$repoRoot = Get-CodeRemoteRepoRoot -ScriptPath $PSCommandPath
$paths = Get-CodeRemotePaths -RepoRoot $repoRoot
$config = Read-CodeRemoteConfig -ConfigFile $paths.ConfigFile
$taskName = [string]$config.autostart.taskName

if ([string]::IsNullOrWhiteSpace($taskName)) {
    throw "autostart.taskName must not be empty."
}

Write-CodeRemoteSection "Uninstall Auto-Start"

try {
    schtasks.exe /delete /tn $taskName /f | Out-Null
    Write-Host ("[OK] Removed scheduled task: {0}" -f $taskName) -ForegroundColor Green
} catch {
    Write-Host ("[INFO] Scheduled task not found: {0}" -f $taskName) -ForegroundColor Yellow
}
