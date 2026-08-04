// 沙箱执行：Python 代码安全检查（AST）+ 内存监控 + 超时
// Windows 无 Python resource 模块，内存限制靠 tasklist 轮询子进程 RSS
import { spawn, execFile } from "node:child_process";

// 危险导入：AI 生成代码常见越权路径
const DANGEROUS_IMPORTS = new Set([
  "os", "subprocess", "socket", "requests", "urllib", "urllib.request",
  "shutil", "pty", "ctypes", "pickle", "telnetlib", "ftplib", "smtplib",
  "http.client", "http.server", "multiprocessing", "threading", "signal",
]);

// 危险调用（Attribute 或 Name）：AI 生成代码常见逃逸
const DANGEROUS_CALLS = new Set([
  "eval", "exec", "compile", "__import__", "input", "breakpoint",
  "os.system", "os.popen", "os.spawn", "os.remove", "os.unlink", "os.rmdir",
  "os.chmod", "os.chown", "os.kill", "os.listdir", "os.walk", "os.stat",
  "subprocess.run", "subprocess.call", "subprocess.Popen", "subprocess.check_output",
  "shutil.rmtree", "shutil.move", "shutil.copy", "shutil.copytree",
  "open", "file", "pathlib.Path.open", "pathlib.Path.write", "pathlib.Path.unlink",
  "glob", "sys.exit", "sys.path", "requests.get", "requests.post", "urllib.request.urlopen",
]);

// 白名单导入：允许的常用计算/数据处理库
const SAFE_IMPORTS = new Set([
  "re", "math", "json", "datetime", "collections", "itertools", "functools",
  "statistics", "random", "string", "textwrap", "decimal", "fractions", "typing",
  "numpy", "pandas",
]);

/**
 * 用 Python 自带 ast 检查源码安全性。
 * 返回 { safe: true } 或 { safe: false, reason: string }。
 * 通过启动 `python -c` 校验子进程实现（Node 无 Python 解析器）。
 */
export async function checkPythonSafety(source: string): Promise<{ safe: boolean; reason?: string }> {
  if (!source.trim()) return { safe: false, reason: "代码为空" };
  const checker = `
import ast, sys
src = sys.stdin.read()
DANGEROUS_IMPORTS = ${JSON.stringify([...DANGEROUS_IMPORTS])}
DANGEROUS_CALLS = ${JSON.stringify([...DANGEROUS_CALLS])}
try:
    tree = ast.parse(src)
except SyntaxError as e:
    print("SYNTAX_ERROR:" + str(e))
    sys.exit(1)
hits = []
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        for a in node.names:
            if a.name.split(".")[0] in DANGEROUS_IMPORTS:
                hits.append(f"import {a.name}")
    elif isinstance(node, ast.ImportFrom):
        if node.module and node.module.split(".")[0] in DANGEROUS_IMPORTS:
            hits.append(f"from {node.module} import ...")
    elif isinstance(node, ast.Call):
        fn = node.func
        name = ""
        if isinstance(fn, ast.Name):
            name = fn.id
        elif isinstance(fn, ast.Attribute):
            name = ast.unparse(fn)
        if name in DANGEROUS_CALLS:
            hits.append(f"调用 {name}")
print(";".join(hits))
sys.exit(0 if not hits else 2)
`;
  return new Promise((resolve) => {
    const proc = spawn("python", ["-c", checker], { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => proc.kill(), 5000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ safe: true });
      } else if (code === 2) {
        resolve({ safe: false, reason: stdout.trim() || "包含危险操作" });
      } else {
        resolve({ safe: false, reason: `代码解析失败: ${stdout.trim() || stderr.trim() || "语法错误"}` });
      }
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ safe: false, reason: `检查进程启动失败: ${e.message}` });
    });
    proc.stdin.write(source);
    proc.stdin.end();
  });
}

/** 内存监控：每 500ms 用 tasklist 读子进程 RSS，超过 maxMb 则 kill 并回调 */
export function monitorMemory(
  pid: number,
  maxMb: number,
  onExceed: (mb: number) => void
): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    execFile("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV"], { windowsHide: true }, (err, stdout) => {
      if (stopped) return;
      if (err) return; // 进程可能已退出
      // CSV: "name","pid","session","#","mem"，内存字段含逗号（如 "4,628 K"），需引号感知解析
      const lines = stdout.split(/\r?\n/).filter((l) => l.includes(`"${pid}"`));
      if (lines.length === 0) return; // 进程已退出
      const fields = lines[0].match(/"([^"]*)"/g) ?? [];
      const memStr = fields[4]?.replace(/"/g, "") ?? "";
      // tasklist 内存字段形如 "5,132 K"（KB）或 "1,024 M"，按单位换算成 MB
      const memMatch = memStr.trim().match(/^([\d,.]+)\s*([KMGT]?B)?$/i);
      if (!memMatch) return;
      const raw = parseFloat(memMatch[1].replace(/,/g, ""));
      const unit = (memMatch[2] ?? "B").toUpperCase();
      const kb = unit === "K" ? raw : unit === "M" ? raw * 1024 : unit === "G" ? raw * 1024 * 1024 : raw;
      const mb = kb / 1024;
      if (mb > maxMb) {
        stopped = true;
        clearInterval(timer);
        onExceed(mb);
      }
    });
  }, 500);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
