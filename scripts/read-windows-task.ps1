param([string]$TaskName)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $scheduler = New-Object -ComObject 'Schedule.Service'
    $scheduler.Connect()
    foreach ($task in $scheduler.GetFolder('\').GetTasks(1)) {
        if ($task.Name -eq $TaskName) {
            [Console]::Write($task.Xml)
            exit 0
        }
    }
    exit 3
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
