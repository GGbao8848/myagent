# 用 NSSM 将 AgentRuntime 注册为 Windows 服务并开机自启
# 前提：已下载 nssm.exe 并完成打包（dist\AgentRuntime\AgentRuntime.exe）
# 用法（管理员 PowerShell）：
#   powershell -ExecutionPolicy Bypass -File packaging\install_service.ps1 `
#     -InstallDir "C:\Program Files\AgentRuntime" -ConfigPath "C:\ProgramData\AgentRuntime\config.yaml"
param(
    [string]$ServiceName = "AgentRuntime",
    [string]$InstallDir = "C:\Program Files\AgentRuntime",
    [string]$ConfigPath = "C:\ProgramData\AgentRuntime\config.yaml",
    [string]$LogDir = "C:\ProgramData\AgentRuntime\logs"
)

$ErrorActionPreference = "Stop"
$AppExe = Join-Path $InstallDir "AgentRuntime.exe"
$Nssm = Join-Path $InstallDir "nssm.exe"

if (-not (Test-Path $Nssm)) { Write-Error "未找到 nssm.exe：$Nssm" }
if (-not (Test-Path $AppExe)) { Write-Error "未找到 AgentRuntime.exe：$AppExe" }
if (-not (Test-Path $ConfigPath)) { Write-Error "未找到配置文件：$ConfigPath" }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

& $Nssm install $ServiceName $AppExe
& $Nssm set $ServiceName AppDirectory $InstallDir
& $Nssm set $ServiceName AppEnvironmentExtra "AGENTRUNTIME_CONFIG=$ConfigPath"
& $Nssm set $ServiceName AppStdout (Join-Path $LogDir "service.out.log")
& $Nssm set $ServiceName AppStderr (Join-Path $LogDir "service.err.log")
& $Nssm set $ServiceName Start SERVICE_AUTO_START
& $Nssm set $ServiceName DisplayName "AgentRuntime MCP Server"
& $Nssm set $ServiceName Description "Windows 本地 Agent Runtime：通过 MCP 暴露本地计算机能力"

& $Nssm start $ServiceName

Write-Host "服务 $ServiceName 已安装并启动（开机自启）。" -ForegroundColor Green
Write-Host "MCP 端点：http://localhost:18544/mcp（端口以 config.yaml 为准）"
