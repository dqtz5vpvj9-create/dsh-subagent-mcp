param([string]$Package, [string]$Workspace, [string]$Callbacks)
$ErrorActionPreference = 'Stop'
try {
    $env:TERM = 'xterm-256color'
    $env:TMPDIR = $Callbacks
    Set-Location -LiteralPath $Workspace
    & npx -y $Package
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
