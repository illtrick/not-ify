$ws = New-Object -ComObject WScript.Shell
$desktopPath = [Environment]::GetFolderPath("Desktop")
$sc = $ws.CreateShortcut("$desktopPath\Not-ify Dev.lnk")
$sc.TargetPath = "$PSScriptRoot\dev.bat"
$sc.WorkingDirectory = $PSScriptRoot
$sc.Description = "Not-ify Dev Manager"
$sc.Save()
Write-Host "Shortcut created on Desktop"
