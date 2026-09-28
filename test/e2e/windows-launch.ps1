param([string]$Run)
$ErrorActionPreference = 'Stop'
try {
    $env:TERM = 'xterm-256color'
    $userDirectory = [Environment]::GetFolderPath('UserProfile')
    $testRoot = Join-Path $userDirectory ('dsh-release-acceptance/' + $Run)
    Remove-Item Env:TMPDIR -ErrorAction SilentlyContinue
    $env:TEMP = Join-Path $testRoot 'callbacks'
    $env:TMP = $env:TEMP
    Set-Location -LiteralPath (Join-Path $testRoot 'Project space 雪')
    & npx --yes --package (Join-Path $userDirectory ('dsh-e2e-candidate-' + $Run + '.tgz')) -- dsh-subagent-mcp
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
