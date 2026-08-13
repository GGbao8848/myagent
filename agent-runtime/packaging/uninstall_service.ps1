# 卸载 AgentRuntime 服务
# 用法（管理员 PowerShell）：powershell -ExecutionPolicy Bypass -File packaging\uninstall_service.ps1
param(
    [string]$ServiceName = "AgentRuntime",
    [string]$InstallDir = "C:\Program Files\AgentRuntime"
)

$ErrorActionPreference = "Stop"
$Nssm = Join-Path $InstallDir "nssm.exe"

if (-not (Test-Path $Nssm)) { Write-Error "未找到 nssm.exe：$Nssm" }

& $Nssm stop $ServiceName
& $Nssm remove $ServiceName confirm

Write-Host "服务 $ServiceName 已停止并移除。" -ForegroundColor Green
