param([string]$Run)
$ErrorActionPreference = 'Stop'
try {
    $env:TERM = 'xterm-256color'
    $userDirectory = [Environment]::GetFolderPath('UserProfile')
    $testRoot = Join-Path $userDirectory ('dsh-release-acceptance/' + $Run)
    $env:TMPDIR = Join-Path $testRoot 'callbacks'
    Set-Location -LiteralPath (Join-Path $testRoot 'Project space 雪')
    & npx -y (Join-Path $userDirectory 'dsh-e2e-candidate.tgz')
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
