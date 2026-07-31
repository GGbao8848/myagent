"""代码安全守卫：AST 审计 + 资源监控 + 网络策略。

为 LocalSandbox 提供三层可配置的运行时防护：
  1. AstAuditor  — 静态 AST 扫描，在执行前发现危险模式
  2. ResourceMonitor — 跨平台进程资源监控（内存/超时）
  3. NetworkPolicy  — 环境变量级别的网络阻断开关

所有组件跨平台（Windows / macOS / Linux），不依赖内核特性。
"""

from __future__ import annotations

import ast
import os
import threading
import time
from dataclasses import dataclass
from typing import Callable

import psutil


# ==========================================================================
# AST 审计
# ==========================================================================

# 危险内置函数 — 允许任意代码执行
_DANGEROUS_BUILTINS = frozenset({"eval", "exec", "compile", "__import__"})

# 敏感模块 — 导入这些说明代码想做系统级操作
_SENSITIVE_MODULES = frozenset({
    "subprocess", "os", "ctypes", "socket", "shutil",
    "importlib", "multiprocessing", "signal", "pickle", "marshal",
    "sys", "threading",
})

# 敏感调用模式: (module_name, function_name) -> severity
_SENSITIVE_CALLS: dict[tuple[str, str], str] = {
    ("os", "system"): "danger",
    ("os", "popen"): "danger",
    ("os", "remove"): "warning",
    ("os", "unlink"): "warning",
    ("os", "rmdir"): "warning",
    ("os", "chmod"): "warning",
    ("os", "chown"): "danger",
    ("subprocess", "run"): "danger",
    ("subprocess", "Popen"): "danger",
    ("subprocess", "call"): "danger",
    ("subprocess", "check_output"): "danger",
    ("subprocess", "check_call"): "danger",
    ("shutil", "rmtree"): "warning",
    ("shutil", "copy"): "info",
    ("shutil", "copy2"): "info",
    ("shutil", "move"): "info",
    ("socket", "socket"): "warning",
    ("socket", "create_connection"): "warning",
    ("ctypes", "CDLL"): "danger",
    ("ctypes", "WinDLL"): "danger",
    ("ctypes", "cdll"): "danger",
    ("pickle", "loads"): "danger",
    ("pickle", "load"): "danger",
    ("importlib", "import_module"): "warning",
    ("multiprocessing", "Process"): "warning",
}


@dataclass
class Finding:
    """AST 扫描发现的问题。"""

    severity: str  # danger | warning | info
    category: str  # code_exec | file_access | import | system | syntax
    message: str
    line: int = 0

    def __str__(self) -> str:
        tag = {"danger": "CRIT", "warning": "WARN", "info": "INFO"}.get(self.severity, "-")
        loc = f"L{self.line}: " if self.line else ""
        return f"[{tag}] [{self.category}] {loc}{self.message}"


class AstAuditor:
    """对 Python 代码做静态 AST 审计。

    这不是安全沙箱的替代品，而是"代码审查层"——
    在执行前给出可见的风险提示，帮助发现 Agent 生成的恶意或错误代码。

    用法:
        findings = AstAuditor.audit(code)
        if AstAuditor.has_danger(findings):
            print("代码包含危险操作！")
    """

    @staticmethod
    def audit(code: str) -> list[Finding]:
        """扫描 Python 代码字符串，返回所有发现。"""
        findings: list[Finding] = []

        if not code.strip():
            return findings

        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            findings.append(Finding(
                severity="danger",
                category="syntax",
                message=f"语法错误: {e.msg}",
                line=e.lineno or 0,
            ))
            return findings

        _AuditVisitor(findings).visit(tree)
        return findings

    @staticmethod
    def has_danger(code_or_findings: str | list[Finding]) -> bool:
        """代码是否包含 danger 级别的操作。"""
        if isinstance(code_or_findings, str):
            findings = AstAuditor.audit(code_or_findings)
        else:
            findings = code_or_findings
        return any(f.severity == "danger" for f in findings)

    @staticmethod
    def format_report(findings: list[Finding]) -> str:
        """将扫描结果格式化为可读报告。"""
        if not findings:
            return "[OK] 未发现危险模式"

        by_severity: dict[str, list[Finding]] = {}
        for f in findings:
            by_severity.setdefault(f.severity, []).append(f)

        lines: list[str] = []
        for sev in ("danger", "warning", "info"):
            items = by_severity.get(sev, [])
            if items:
                lines.append(f"--- {sev.upper()} ({len(items)} 项) ---")
                for item in items:
                    lines.append(f"  {item}")
        return "\n".join(lines)


class _AuditVisitor(ast.NodeVisitor):
    """遍历 AST，收集危险模式。"""

    def __init__(self, findings: list[Finding]) -> None:
        self.findings = findings

    def visit_Call(self, node: ast.Call) -> None:  # noqa: C901
        # --- 直接调用危险内置函数 ---
        if isinstance(node.func, ast.Name):
            name = node.func.id
            if name in _DANGEROUS_BUILTINS:
                self.findings.append(Finding(
                    severity="danger",
                    category="code_exec",
                    message=f"调用 {name}() — 允许任意代码执行",
                    line=node.lineno,
                ))
            elif name == "open":
                self._check_open(node)

        # --- module.func() 模式 ---
        elif isinstance(node.func, ast.Attribute):
            func_name = node.func.attr
            if isinstance(node.func.value, ast.Name):
                mod_name = node.func.value.id
                severity = _SENSITIVE_CALLS.get((mod_name, func_name))
                if severity:
                    self.findings.append(Finding(
                        severity=severity,
                        category="system",
                        message=f"调用 {mod_name}.{func_name}()",
                        line=node.lineno,
                    ))
                # open() 作为 builtins.open 调用
                elif mod_name == "builtins" and func_name == "open":
                    self._check_open(node)

            # --- module.sub.func() 链式调用 ---
            elif isinstance(node.func.value, ast.Attribute):
                # os.path.remove 等
                if isinstance(node.func.value.value, ast.Name):
                    mod = node.func.value.value.id
                    sub = node.func.value.attr
                    full = f"{mod}.{sub}"
                    if full in ("os.path", "os.chmod", "os.chown"):
                        self.findings.append(Finding(
                            severity="warning",
                            category="file_access",
                            message=f"调用 {full}.{func_name}()",
                            line=node.lineno,
                        ))

        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            base = alias.name.split(".")[0]
            if base in _SENSITIVE_MODULES:
                self.findings.append(Finding(
                    severity="warning",
                    category="import",
                    message=f"导入敏感模块: {alias.name}",
                    line=node.lineno,
                ))
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module:
            base = node.module.split(".")[0]
            if base in _SENSITIVE_MODULES:
                self.findings.append(Finding(
                    severity="warning",
                    category="import",
                    message=f"从敏感模块导入: {node.module}",
                    line=node.lineno,
                ))
        self.generic_visit(node)

    def visit_Delete(self, node: ast.Delete) -> None:
        """`del x` 虽然少见但值得标记。"""
        self.findings.append(Finding(
            severity="info",
            category="file_access",
            message="使用 del 语句",
            line=node.lineno,
        ))
        self.generic_visit(node)

    def _check_open(self, node: ast.Call) -> None:
        """检查 open() 调用的写入模式。"""
        if len(node.args) >= 2:
            mode_arg = node.args[1]
            if isinstance(mode_arg, ast.Constant) and isinstance(mode_arg.value, str):
                mode = mode_arg.value
                if "w" in mode or "a" in mode:
                    self.findings.append(Finding(
                        severity="warning",
                        category="file_access",
                        message=f"open() 以写入模式 ('{mode}') 打开文件",
                        line=node.lineno,
                    ))
                    return
                elif "x" in mode:
                    self.findings.append(Finding(
                        severity="info",
                        category="file_access",
                        message="open() 以独占创建模式 ('x') 打开文件",
                        line=node.lineno,
                    ))
                    return
            # 模式由变量决定，无法静态分析
            self.findings.append(Finding(
                severity="info",
                category="file_access",
                message="open() — 文件模式由变量决定",
                line=node.lineno,
            ))
        else:
            self.findings.append(Finding(
                severity="info",
                category="file_access",
                message="open() 以默认只读模式打开",
                line=node.lineno,
            ))


# ==========================================================================
# 资源监控
# ==========================================================================


class ResourceViolation(Exception):
    """资源限制违规。"""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ResourceMonitor:
    """跨平台进程资源监控器。

    在后台线程中轮询子进程的内存使用和运行时间，
    超限时自动终止进程树。

    用法:
        monitor = ResourceMonitor(memory_mb=512, timeout_sec=60)
        monitor.start(proc.pid)
        # ... 等待进程结束 ...
        violation = monitor.stop()
        if violation:
            print(f"资源违规: {violation}")
    """

    # 轮询间隔（秒）
    _POLL_INTERVAL = 0.2

    def __init__(
        self,
        memory_mb: int = 0,
        timeout_sec: int = 0,
        on_violation: Callable[[str], None] | None = None,
    ) -> None:
        """
        Args:
            memory_mb: 内存上限（MB），0 = 不限制
            timeout_sec: 超时上限（秒），0 = 不限制
            on_violation: 违规时的回调
        """
        self._memory_mb = memory_mb
        self._timeout_sec = timeout_sec
        self._on_violation = on_violation
        self._stop = threading.Event()
        self._violation: str | None = None
        self._thread: threading.Thread | None = None

    @property
    def is_active(self) -> bool:
        return bool(self._memory_mb or self._timeout_sec)

    def start(self, pid: int) -> None:
        """启动后台监控线程。"""
        if not self.is_active:
            return
        self._stop.clear()
        self._violation = None
        self._thread = threading.Thread(
            target=self._loop, args=(pid,), daemon=True, name=f"guard-{pid}"
        )
        self._thread.start()

    def stop(self) -> str | None:
        """停止监控，返回违规信息（如果没有违规则返回 None）。"""
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        return self._violation

    # ---- 内部 ----

    def _loop(self, pid: int) -> None:
        try:
            proc = psutil.Process(pid)
        except psutil.NoSuchProcess:
            return

        start = time.monotonic()

        while not self._stop.is_set():
            # 进程存活检查
            try:
                alive = proc.is_running()
            except psutil.NoSuchProcess:
                return
            if not alive:
                return

            # ---- 超时检查 ----
            if self._timeout_sec:
                elapsed = time.monotonic() - start
                if elapsed > self._timeout_sec:
                    self._violation = f"执行超时 ({self._timeout_sec}s)"
                    self._terminate(proc)
                    return

            # ---- 内存检查 ----
            if self._memory_mb:
                try:
                    mem = proc.memory_info().rss / (1024 * 1024)
                    for child in proc.children(recursive=True):
                        try:
                            mem += child.memory_info().rss / (1024 * 1024)
                        except psutil.NoSuchProcess:
                            pass
                    if mem > self._memory_mb:
                        self._violation = (
                            f"内存超限 ({mem:.0f}MB > {self._memory_mb}MB)"
                        )
                        self._terminate(proc)
                        return
                except psutil.NoSuchProcess:
                    return

            self._stop.wait(self._POLL_INTERVAL)

    def _terminate(self, proc: psutil.Process) -> None:
        """终止进程及其所有子进程。"""
        try:
            children = proc.children(recursive=True)
        except psutil.NoSuchProcess:
            children = []
        for child in children:
            try:
                child.kill()
            except psutil.NoSuchProcess:
                pass
        try:
            proc.kill()
        except psutil.NoSuchProcess:
            pass
        if self._on_violation:
            self._on_violation(self._violation or "资源限制触发")


# ==========================================================================
# 网络策略
# ==========================================================================


class NetworkPolicy:
    """环境变量级网络阻断。

    通过设置 http_proxy / https_proxy 指向无效地址来阻断 HTTP 流量。
    这是"软阻断"——进程可以绕过环境变量，但对绝大多数代码有效。

    用法:
        policy = NetworkPolicy.block()
        env = policy.apply_to_env(os.environ.copy())
        subprocess.run(..., env=env)

        # 或允许网络（默认）:
        policy = NetworkPolicy.allow()
    """

    # 指向一个必定不可达的地址
    _DEAD_PROXY = "http://127.0.0.1:9"

    # 要设置的代理环境变量
    _PROXY_VARS = (
        "http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY",
        "all_proxy", "ALL_PROXY",
    )

    def __init__(self, blocked: bool = False) -> None:
        self._blocked = blocked

    @classmethod
    def allow(cls) -> "NetworkPolicy":
        """创建允许网络的策略。"""
        return cls(blocked=False)

    @classmethod
    def block(cls) -> "NetworkPolicy":
        """创建阻断网络的策略。"""
        return cls(blocked=True)

    @property
    def is_blocked(self) -> bool:
        return self._blocked

    def apply_to_env(self, env: dict[str, str]) -> dict[str, str]:
        """将策略应用到环境变量字典，返回修改后的副本。"""
        if not self._blocked:
            return env
        for var in self._PROXY_VARS:
            env[var] = self._DEAD_PROXY
        env["no_proxy"] = ""
        env["NO_PROXY"] = ""
        return env


# ==========================================================================
# 辅助：从 shell 命令中提取 Python 代码
# ==========================================================================


def sniff_python_code(command: str) -> tuple[str | None, str]:
    """尝试从 shell 命令中提取 Python 代码片段用于审计。

    Returns:
        (code, kind): code 是可审计的 Python 源码，kind 是 'inline' | 'file' | 'module' | 'none'
    """
    cmd = command.strip()

    # 跳过不以 python 开头的命令
    if not (cmd.startswith("python") or cmd.startswith("python3")):
        return None, "none"

    # python -c "..."
    if " -c " in cmd:
        idx = cmd.index(" -c ") + 4
        rest = cmd[idx:].strip()
        # 去除首尾引号
        for q in ('"""', "'''", '"', "'"):
            if rest.startswith(q) and rest.endswith(q) and len(rest) >= len(q) * 2:
                rest = rest[len(q):-len(q)]
                break
        return rest, "inline"

    # python -m module
    if " -m " in cmd:
        return None, "module"

    # python script.py
    parts = cmd.split(maxsplit=1)
    if len(parts) == 2 and parts[1].split()[0].endswith(".py"):
        return None, "file"

    return None, "none"
