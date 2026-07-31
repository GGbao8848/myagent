"""WSL 检测与引导工具。

提供一键检测 WSL 可用性、安装引导、分发版自动发现等功能。
可在应用启动时调用，也可作为独立脚本运行。
"""

from __future__ import annotations

import logging
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class WslCheckResult:
    """WSL 检测结果。"""

    wsl_installed: bool = False
    """wsl.exe 是否可用。"""

    distro_installed: bool = False
    """是否有已安装的 Linux 分发版。"""

    distro_name: str = ""
    """第一个可用分发版的名称。"""

    wsl_version: int = 0
    """WSL 版本（1 或 2）。"""

    errors: list[str] = field(default_factory=list)
    """检测过程中的错误信息。"""

    @property
    def ok(self) -> bool:
        """WSL 是否完整可用（wsl.exe + 已安装分发版）。"""
        return self.wsl_installed and self.distro_installed

    @property
    def summary(self) -> str:
        """返回人类可读的检测摘要。"""
        if not self.wsl_installed:
            return "❌ WSL 未安装"
        if not self.distro_installed:
            return "❌ WSL 已安装，但未找到 Linux 分发版"
        return f"✅ WSL {self.wsl_version} · {self.distro_name}"


def check_wsl() -> WslCheckResult:
    """一键检测 WSL 环境状态。

    检测项：
      1. wsl.exe 是否在 PATH 中
      2. 是否有已安装的 Linux 分发版
      3. 分发版的 WSL 版本

    Returns:
        WslCheckResult: 包含所有检测结果的 dataclass。
    """
    result = WslCheckResult()

    # ── 检测 wsl.exe ──
    try:
        subprocess.run(
            ["wsl", "--help"],
            capture_output=True, timeout=5,
        )
        result.wsl_installed = True
    except FileNotFoundError:
        result.errors.append("wsl.exe 未找到，请确保 WSL 功能已启用。")
        return result
    except Exception as e:
        result.errors.append(f"wsl.exe 检测异常: {e}")
        return result

    # ── 检测已安装的分发版 ──
    try:
        proc = subprocess.run(
            ["wsl", "-l", "-v"],
            capture_output=True, timeout=10,
        )
        if proc.returncode != 0:
            result.errors.append(f"wsl -l -v 执行失败")
            return result

        # wsl 输出可能是 UTF-16LE 或 GBK，尝试多种解码
        stdout = _decode_output(proc.stdout)
        lines = [l.strip() for l in stdout.splitlines() if l.strip()]
        # 跳过表头行（NAME / STATE / VERSION）
        data_lines = [l for l in lines if l and not l.startswith("NAME")]
        if not data_lines:
            return result

        # 解析第一行
        # 格式: "* Ubuntu    Running    2" 或 "  Ubuntu    Stopped    2"
        first = data_lines[0]
        parts = first.split()
        if len(parts) >= 3:
            # 可能带星号，如 "* Ubuntu"
            name = parts[1] if parts[0] == "*" else parts[0]
            version_str = parts[-1]
            result.distro_name = name
            result.distro_installed = True
            try:
                result.wsl_version = int(version_str)
            except ValueError:
                pass

    except Exception as e:
        result.errors.append(f"分发版检测异常: {e}")

    return result


def guide_install() -> str:
    """返回 WSL 安装引导说明（Markdown 格式）。

    适用于用户未安装 WSL 或分发版时的提示。
    """
    return """## WSL 环境检测

当前未检测到可用的 WSL Linux 环境。

### 一键安装（Windows 10 2004+ / Windows 11）

以 **管理员身份** 打开 PowerShell，执行：

```powershell
wsl --install
```

### 手动安装（Windows 10 Build 19043 及以下）

1. 以管理员身份打开 PowerShell，启用 WSL 功能：

```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
```

2. 重启电脑

3. 设置 WSL 2 为默认版本并安装 Ubuntu：

```powershell
wsl --set-default-version 2
wsl --install -d Ubuntu
```

> 如果 `wsl --install` 不可用，请从 [Ubuntu WSL 镜像](https://cloud-images.ubuntu.com/wsl/releases/) 手动下载 rootfs.tar.gz，
> 然后使用 `wsl --import Ubuntu <安装路径> <镜像文件> --version 2` 导入。

### 验证安装

```powershell
wsl -l -v
```

### 配置代理（可选，适用于代理环境）

在 WSL 中配置代理：

```bash
echo 'export http_proxy=http://127.0.0.1:7890' >> ~/.bashrc
echo 'export https_proxy=http://127.0.0.1:7890' >> ~/.bashrc
source ~/.bashrc
```
"""


def ensure_wsl() -> Optional[str]:
    """确保 WSL 可用，不可用时返回引导说明，可用时返回 None。

    应用启动时可调用此函数，如果返回非 None 说明需要引导用户安装。
    """
    result = check_wsl()
    if result.ok:
        logger.info("WSL 环境正常: %s", result.summary)
        return None
    logger.warning("WSL 环境异常: %s", result.summary)
    return guide_install()


def configure_wsl_proxy(proxy: str = "http://127.0.0.1:7890") -> str:
    """在 WSL 中配置代理。

    通过 ``wsl -d <distro> -- bash -c`` 命令向 WSL 的 ~/.bashrc 中写入代理配置。

    Args:
        proxy: 代理地址，默认 http://127.0.0.1:7890。

    Returns:
        配置结果描述。
    """
    distro = "Ubuntu"
    cmd = (
        f'echo "export http_proxy={proxy}" >> ~/.bashrc && '
        f'echo "export https_proxy={proxy}" >> ~/.bashrc && '
        f'echo "proxy 已配置: {proxy}"'
    )
    try:
        proc = subprocess.run(
            ["wsl", "-d", distro, "--", "bash", "-c", cmd],
            capture_output=True, timeout=10,
        )
        out = _decode_output(proc.stdout)
        err = _decode_output(proc.stderr)
        if proc.returncode == 0:
            return f"✅ WSL ({distro}) 代理已配置: {proxy}"
        return f"❌ 配置失败: {err.strip()}"
    except Exception as e:
        return f"❌ 配置异常: {e}"


def _decode_output(data: bytes) -> str:
    """尝试多种编码解码 WSL 输出。

    wsl.exe 在不同 Windows 版本下可能输出 UTF-16LE 或 GBK。
    """
    for enc in ("utf-16-le", "utf-8", "gbk"):
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", errors="replace")


# ────────────────────────────────────────────────────────────────
# 独立运行入口
# ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 50)
    print("  WSL 环境检测工具")
    print("=" * 50)
    print()

    result = check_wsl()
    print(f"  wsl.exe 可用:      {'✅' if result.wsl_installed else '❌'}")
    print(f"  分发版已安装:      {'✅' if result.distro_installed else '❌'}")
    if result.distro_name:
        print(f"  分发版名称:        {result.distro_name}")
    if result.wsl_version:
        print(f"  WSL 版本:          {result.wsl_version}")
    if result.errors:
        print(f"  错误:              {result.errors}")

    print()
    print(f"  状态: {result.summary}")

    if not result.ok:
        print()
        print(guide_install())