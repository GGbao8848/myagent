"""AgentRuntime 原生 Windows 服务（pywin32）。

提供一条独立于 nssm 的服务化路径：
    python -m agent_runtime.service install      # 安装服务
    python -m agent_runtime.service start        # 启动
    python -m agent_runtime.service stop         # 停止
    python -m agent_runtime.service remove       # 卸载
    python -m agent_runtime.service debug        # 前台调试运行
"""
from __future__ import annotations

import sys
import threading

import servicemanager
import win32event
import win32service
import win32serviceutil

SERVICE_NAME = "AgentRuntime"
SERVICE_DISPLAY_NAME = "AgentRuntime MCP Server"
SERVICE_DESCRIPTION = "Windows 本地 Agent Runtime：通过 MCP 暴露本地计算机能力"


class AgentRuntimeService(win32serviceutil.ServiceFramework):
    _svc_name_ = SERVICE_NAME
    _svc_display_name_ = SERVICE_DISPLAY_NAME
    _svc_description_ = SERVICE_DESCRIPTION

    def __init__(self, args):
        super().__init__(args)
        self.hWaitStop = win32event.CreateEvent(None, 0, 0, None)
        self._server_thread: threading.Thread | None = None

    def SvcStop(self):
        """服务停止回调：置停止事件，让主循环退出。"""
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        win32event.SetEvent(self.hWaitStop)

    def SvcDoRun(self):
        """服务主循环：在子线程里跑 MCP server，主线程等待停止事件。"""
        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STARTED,
            (self._svc_name_, ""),
        )
        # 关键：必须向 SCM 报告 RUNNING，否则 30 秒后报 1053「未及时响应」
        self.ReportServiceStatus(win32service.SERVICE_RUNNING)
        self._server_thread = threading.Thread(target=self._run_server, daemon=True)
        self._server_thread.start()
        # 等待 SvcStop 置停止事件
        win32event.WaitForSingleObject(self.hWaitStop, win32event.INFINITE)

    def _run_server(self):
        """在子线程里启动 MCP 服务（阻塞式，直到进程被终止）。"""
        # 延迟导入，避免影响 install/debug 等非运行路径
        from agent_runtime.config import load_config
        from agent_runtime.server import build_server

        try:
            cfg = load_config()
            mcp = build_server(cfg)
            mcp.run(
                transport="streamable-http",
                host=cfg.server.host,
                port=cfg.server.port,
                streamable_http_path=cfg.server.path,
            )
        except Exception as exc:  # pragma: no cover - 服务进程内兜底
            servicemanager.LogErrorMsg(f"AgentRuntime 服务运行异常: {exc}")
            raise


def main():
    """命令行入口：转发给 win32serviceutil 处理 install/start/stop/remove/debug。"""
    if len(sys.argv) == 1:
        sys.argv.append("debug")
    win32serviceutil.HandleCommandLine(AgentRuntimeService)


if __name__ == "__main__":
    main()
