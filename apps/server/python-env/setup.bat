@echo off
REM 一键创建共享 Python 环境（uv + venv + 依赖）
REM 用法：双击运行，或 cmd /c python-env\setup.bat
setlocal
cd /d "%~dp0\.."

REM 确保 uv 可用
where uv >nul 2>nul
if errorlevel 1 (
  echo [setup] 未找到 uv，正在安装...
  curl -x http://127.0.0.1:7890 -LsSf https://astral.sh/uv/install.sh | sh
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)

echo [setup] 创建虚拟环境 .venv（Python 3.11）...
if not exist .venv uv venv .venv --python 3.11

echo [setup] 安装依赖...
uv pip install -r python-env\requirements.txt

echo [setup] 验证...
.venv\Scripts\python.exe -c "import requests, Crypto.Cipher.AES, dotenv; print('环境就绪:', requests.__version__)"

echo [setup] 完成。可用 .venv\Scripts\python.exe 运行脚本
endlocal
