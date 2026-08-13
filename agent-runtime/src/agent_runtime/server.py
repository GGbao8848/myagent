"""MCP Server 组装：注册 4 个工具，注入权限层与审计日志。"""
from __future__ import annotations

from mcp.server import MCPServer

from agent_runtime.config import AppConfig
from agent_runtime.security.audit import AuditLogger, _Timer
from agent_runtime.security.command_policy import CommandPolicy
from agent_runtime.security.path_policy import PathPolicy
from agent_runtime.tools import exec_tool, file_tools

_SERVER_INSTRUCTIONS = (
    "AgentRuntime 是运行在员工 Windows 电脑上的本地运行时，"
    "通过 MCP 向 Agent 暴露受控的本地命令执行与文件操作能力。"
    "所有操作均受目录白名单与命令白名单约束，并记录审计日志。"
)


def build_server(cfg: AppConfig) -> MCPServer:
    mcp = MCPServer("AgentRuntime", instructions=_SERVER_INSTRUCTIONS)

    path_policy = PathPolicy(cfg.security.allowed_dirs)
    cmd_policy = CommandPolicy(cfg.security.allowed_commands)
    audit = AuditLogger(
        cfg.logging.log_dir,
        cfg.logging.audit_file,
        cfg.logging.max_bytes,
        cfg.logging.backup_count,
    )

    @mcp.tool()
    def local_exec(command: str, cwd: str = ".") -> str:
        """在员工本机执行一条命令（仅限白名单命令），返回退出码、标准输出与标准错误。

        Args:
            command: 要执行的完整命令，例如 "python build.py" 或 "dir"。
            cwd: 工作目录，可为允许目录内的相对或绝对路径，默认 "."。

        Python 环境约定：
        - 执行 Python 脚本请固定用工作区虚拟环境解释器：
          ".venv\\Scripts\\python.exe"（相对 cwd），其中已预装 matplotlib/numpy/pandas/openpyxl/requests 等常用库。
        - 运行脚本缺少某个库时，用 uv 装到该虚拟环境：
          "uv pip install --python .venv\\Scripts\\python.exe <包名>"，装完重试脚本。
        - 不要用系统 python -m pip 安装（环境由 uv 托管，会报 externally-managed-environment）。
        - 不要用 uv run 执行脚本（无项目文件时会自动下载 pyinstaller 并创建临时环境，污染本机）。
        """
        timer = _Timer()
        params = {"command": command, "cwd": cwd}
        try:
            result = exec_tool.exec_local_command(
                cmd_policy, path_policy, command, cfg.security.exec_timeout_seconds, cwd
            )
            audit.log("local_exec", params, True, timer.elapsed_ms())
            return result
        except PermissionError as exc:
            audit.log("local_exec", params, False, timer.elapsed_ms(), str(exc))
            return f"错误：{exc}"
        except Exception as exc:  # 兜底，避免工具异常冒泡
            audit.log("local_exec", params, False, timer.elapsed_ms(), str(exc))
            return f"错误：{exc}"

    @mcp.tool()
    def local_read_file(path: str) -> str:
        """读取允许目录内的一个文本文件，返回其内容。

        Args:
            path: 文件路径，可为允许目录内的相对或绝对路径。
        """
        timer = _Timer()
        params = {"path": path}
        try:
            result = file_tools.read_file(path_policy, path, cfg.security.max_file_size_bytes)
            audit.log("local_read_file", params, True, timer.elapsed_ms())
            return result
        except PermissionError as exc:
            audit.log("local_read_file", params, False, timer.elapsed_ms(), str(exc))
            return f"错误：{exc}"
        except Exception as exc:
            audit.log("local_read_file", params, False, timer.elapsed_ms(), str(exc))
            return f"错误：{exc}"

    @mcp.tool()
    def local_write_file(path: str, content: str) -> str:
        """向允许目录内的一个文件写入文本内容（覆盖写入）。

        Args:
            path: 文件路径，可为允许目录内的相对或绝对路径。
            content: 要写入的完整文本内容。
        """
        timer = _Timer()
        params = {"path": path, "content": content}
        try:
            result = file_tools.write_file(path_policy, path, content)
            audit.log("local_write_file", {"path": path, "content_len": len(content)}, True, timer.elapsed_ms())
            return result
        except PermissionError as exc:
            audit.log("local_write_file", {"path": path}, False, timer.elapsed_ms(), str(exc))
            return f"错误：{exc}"
        except Exception as exc:
            audit.log("local_write_file", {"path": path}, False, timer.elapsed_ms(), str(exc))
            return f"错误：{exc}"

    @mcp.tool()
    def local_list_files(path: str = ".") -> str:
        """列出允许目录内的文件与子目录（含类型、大小、修改时间）。

        Args:
            path: 目录路径，可为允许目录内的相对或绝对路径，默认 "."。
        """
        timer = _Timer()
        params = {"path": path}
        try:
            result = file_tools.list_files(path_policy, path)
            audit.log("local_list_files", params, True, timer.elapsed_ms())
            return result
        except PermissionError as exc:
            audit.log("local_list_files", params, False, timer.elapsed_ms(), str(exc))
            return f"错误：{exc}"
        except Exception as exc:
            audit.log("local_list_files", params, False, timer.elapsed_ms(), str(exc))
            return f"错误：{exc}"

    return mcp
