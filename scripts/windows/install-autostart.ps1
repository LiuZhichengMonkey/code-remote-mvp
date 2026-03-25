$ErrorActionPreference = "Stop"
. "$PSScriptRoot\modules\Common.ps1"

$repoRoot = Get-CodeRemoteRepoRoot -ScriptPath $PSCommandPath
$paths = Get-CodeRemotePaths -RepoRoot $repoRoot
$config = Read-CodeRemoteConfig -ConfigFile $paths.ConfigFile
$taskName = [string]$config.autostart.taskName
$legacyBatchLauncher = Join-Path $repoRoot "start-services.bat"

if ([string]::IsNullOrWhiteSpace($taskName)) {
    throw "autostart.taskName must not be empty."
}

Assert-CodeRemoteFile -FilePath $paths.StartScript -Message "Missing start script: $($paths.StartScript)"
Assert-CodeRemoteFile -FilePath $legacyBatchLauncher -Message "Missing legacy batch launcher: $legacyBatchLauncher"
Assert-CodeRemoteFile -FilePath $paths.ServerEntry -Message "Missing server build output. Run .\scripts\windows\setup.ps1 first."
Assert-CodeRemoteFile -FilePath $paths.WebIndex -Message "Missing web build output. Run .\scripts\windows\setup.ps1 first."

Write-CodeRemoteSection "Install Auto-Start"

$taskCommand = Get-CodeRemoteStartScriptCommand -StartScriptPath $paths.StartScript -Autostart
$taskNamesToReplace = @(
    $taskName,
    "CodeRemote-AutoStart"
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

foreach ($candidateTaskName in $taskNamesToReplace) {
    try {
        Unregister-ScheduledTask -TaskName $candidateTaskName -Confirm:$false -ErrorAction Stop
        Write-Host ("[OK] Removed previous scheduled task: {0}" -f $candidateTaskName) -ForegroundColor Yellow
    } catch {
    }
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Autostart' -f $paths.StartScript)
$trigger = New-ScheduledTaskTrigger -AtLogOn

$usedExistingTask = $false
try {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Description "Start CodeRemote with the one-click start script at user logon." `
        -Force `
        -ErrorAction Stop | Out-Null
} catch {
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        $usedExistingTask = $true
        Write-Host ("[WARN] Could not overwrite existing scheduled task: {0}" -f $taskName) -ForegroundColor Yellow
        Write-Host ("[WARN] Falling back to the existing task entry. It now reaches the new launcher through {0}" -f $legacyBatchLauncher) -ForegroundColor Yellow
    } else {
        throw
    }
}

Write-Host ("[OK] Installed scheduled task: {0}" -f $taskName) -ForegroundColor Green
Write-Host "[OK] Auto-start will launch scripts\\windows\\start.ps1" -ForegroundColor Green
if ($usedExistingTask) {
    Write-Host ("[OK] Existing task remains in place and will call {0}" -f $legacyBatchLauncher) -ForegroundColor Green
}
Write-Host ("Command: {0}" -f $taskCommand) -ForegroundColor White
