param([string]$Run, [ValidateSet('install','codex','permission-review')][string]$Action = 'install')
$ErrorActionPreference = 'Stop'
try {
    $env:TERM = 'xterm-256color'
    $userDirectory = [Environment]::GetFolderPath('UserProfile')
    $testRoot = Join-Path $userDirectory ('dsh-release-acceptance/' + $Run)
    Remove-Item Env:TMPDIR -ErrorAction SilentlyContinue
    $env:TEMP = Join-Path $testRoot 'callbacks'
    $env:TMP = $env:TEMP
    Set-Location -LiteralPath (Join-Path $testRoot 'Project space 雪')
    $commandArguments = @('--yes', '--package', (Join-Path $userDirectory ('dsh-e2e-candidate-' + $Run + '.tgz')), '--', 'dsh-subagent-mcp')
    if ($Action -eq 'codex') { $commandArguments += 'codex' }
    if ($Action -eq 'permission-review') {
        $commandArguments += @('codex', '-a', 'on-request', '-c', 'mcp_servers.dsh_subagent.tools.dsh_start.approval_mode="prompt"')
    }
    & npx @commandArguments
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
