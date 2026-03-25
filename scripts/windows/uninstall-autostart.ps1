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

$taskNamesToRemove = @(
    $taskName,
    "CodeRemote-AutoStart"
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

foreach ($candidateTaskName in $taskNamesToRemove) {
    try {
        Unregister-ScheduledTask -TaskName $candidateTaskName -Confirm:$false -ErrorAction Stop
        Write-Host ("[OK] Removed scheduled task: {0}" -f $candidateTaskName) -ForegroundColor Green
    } catch {
        Write-Host ("[INFO] Scheduled task not found: {0}" -f $candidateTaskName) -ForegroundColor Yellow
    }
}
