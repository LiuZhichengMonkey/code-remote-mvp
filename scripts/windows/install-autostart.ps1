$ErrorActionPreference = "Stop"
. "$PSScriptRoot\modules\Common.ps1"

$repoRoot = Get-CodeRemoteRepoRoot -ScriptPath $PSCommandPath
$paths = Get-CodeRemotePaths -RepoRoot $repoRoot
$config = Read-CodeRemoteConfig -ConfigFile $paths.ConfigFile
$taskName = [string]$config.autostart.taskName

if ([string]::IsNullOrWhiteSpace($taskName)) {
    throw "autostart.taskName must not be empty."
}

Assert-CodeRemoteFile -FilePath $paths.StartScript -Message "Missing start script: $($paths.StartScript)"
Assert-CodeRemoteFile -FilePath $paths.ServerEntry -Message "Missing server build output. Run .\scripts\windows\setup.ps1 first."
Assert-CodeRemoteFile -FilePath $paths.WebIndex -Message "Missing web build output. Run .\scripts\windows\setup.ps1 first."

Write-CodeRemoteSection "Install Auto-Start"

$taskCommand = ('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Autostart' -f $paths.StartScript)
schtasks.exe /create /tn $taskName /tr $taskCommand /sc ONLOGON /f | Out-Null

Write-Host ("[OK] Installed scheduled task: {0}" -f $taskName) -ForegroundColor Green
Write-Host ("Command: {0}" -f $taskCommand) -ForegroundColor White
