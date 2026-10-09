param([string]$CommandLine, [string]$WorkingDirectory)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    # WMI creates the process outside OpenSSH's job. A detached child of sshd
    # would otherwise be terminated when the installing SSH connection closes.
    $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow = [uint16]0}
    $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = $CommandLine
        CurrentDirectory = $WorkingDirectory
        ProcessStartupInformation = $startup
    }
    if ($result.ReturnValue -ne 0) {throw "Windows process creation failed: $($result.ReturnValue)"}
    [Console]::WriteLine($result.ProcessId)
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
