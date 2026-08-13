# AgentRuntime 打包脚本：用 PyInstaller 打包为 onedir 可执行目录
# 用法：powershell -ExecutionPolicy Bypass -File packaging\build.ps1
param(
    [string]$OutputDir = "output"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    Write-Error "未找到虚拟环境 $VenvPython。请先执行：uv venv --python 3.11 .venv && uv pip install --python .venv\Scripts\python.exe mcp pyyaml"
    exit 1
}

# 安装打包依赖（如需走代理，可先设置 $env:HTTPS_PROXY='http://127.0.0.1:7890'）
& $VenvPython -m pip install pyinstaller
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Dist = Join-Path $Root "dist"
if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }

# onedir 模式对 uvicorn/starlette 的兼容性优于 onefile
& $VenvPython -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --name AgentRuntime `
    --paths (Join-Path $Root "src") `
    --collect-all mcp `
    --collect-all mcp_types `
    --collect-all uvicorn `
    --collect-all starlette `
    --collect-all sse_starlette `
    (Join-Path $PSScriptRoot "entry.py")

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$DistExe = Join-Path $Dist "AgentRuntime\AgentRuntime.exe"
Write-Host ""
Write-Host "打包完成：$DistExe" -ForegroundColor Green
Write-Host "将 dist\AgentRuntime 整个目录复制到安装目录（如 C:\Program Files\AgentRuntime）即可。"
