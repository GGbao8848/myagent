// 内置工具：脚本执行（技能脚本 + 通用 Python 沙箱执行）
import { tool } from "langchain";
import { z } from "zod";
import { spawn } from "node:child_process";
import { resolve, relative, join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { loadConfig } from "../config.js";
import { checkPythonSafety, monitorMemory } from "./sandbox.js";

const config = loadConfig();

// 解析共享 Python 解释器：优先配置的固定路径（默认项目 .venv），不存在则回退 PATH 的 python
function resolvePython(): string {
  const fixed = config.pythonPath;
  if (fixed && existsSync(fixed)) return fixed;
  return "python";
}

// 限定在 data 目录内解析路径，防路径穿越
function safeResolve(cwd: string, script: string): string {
  const dataRoot = resolve(config.dataDir);
  const full = resolve(join(dataRoot, cwd, script));
  const rel = relative(dataRoot, full);
  if (rel.startsWith("..") || rel.includes("..\\")) {
    throw new Error(`路径越权：${script}`);
  }
  return full;
}

// 运行 Python：统一执行器（AST 安全检查 + 内存监控 + 超时）
async function runPython(
  pythonArgs: string[],
  cwd: string,
  opts: { timeout: number; maxMemoryMb: number }
): Promise<string> {
  return new Promise<string>((resolvePromise) => {
    const proc = spawn(resolvePython(), pythonArgs, {
      cwd,
      env: { ...process.env },
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    let killed = false;
    const finish = (result: string) => {
      if (!finished) {
        finished = true;
        stopMonitor();
        resolvePromise(result);
      }
    };
    const timer = setTimeout(() => {
      killed = true;
      proc.kill();
      finish(JSON.stringify({ error: `脚本超时（${opts.timeout}s）` }));
    }, opts.timeout * 1000);
    // 内存监控：超限 kill
    let stopMonitor = () => {};
    proc.on("spawn", () => {
      stopMonitor = monitorMemory(proc.pid!, opts.maxMemoryMb, (mb) => {
        killed = true;
        proc.kill();
        clearTimeout(timer);
        finish(JSON.stringify({ error: `内存超限（${Math.round(mb)}MB > ${opts.maxMemoryMb}MB）` }));
      });
    });
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      clearTimeout(timer);
      finish(JSON.stringify({ exitCode: killed ? "killed" : code, stdout, stderr }));
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      finish(JSON.stringify({ error: e.message }));
    });
  });
}

// 运行技能目录内的 Python 脚本（技能脚本为用户安装的可信业务代码，不套 AI 代码的 AST 拦截；
// 联网/读写文件是技能的正当能力，沙箱只防失控：超时 + 内存监控）
const runScript = tool(
  async ({ cwd, script, args, input, timeout, maxMemoryMb }: {
    cwd: string;
    script: string;
    args: string[];
    input: string;
    timeout: number;
    maxMemoryMb: number;
  }) => {
    try {
      const scriptPath = safeResolve(cwd, script);
      const workdir = resolve(config.dataDir, cwd);
      if (!existsSync(scriptPath)) {
        return JSON.stringify({ error: `脚本不存在：${scriptPath}` });
      }
      return await runPython([scriptPath, ...args], workdir, {
        timeout,
        maxMemoryMb,
      });
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "run_script",
    description:
      "在数据目录下的指定子目录中运行一个 Python 脚本。用于执行技能附带的脚本（如 data/skills/<skill>/scripts/xxx.py）。返回 JSON {exitCode, stdout, stderr}。",
    schema: z.object({
      cwd: z.string().describe("技能子目录，如 skills/xxx"),
      script: z.string().describe("脚本路径（相对于 cwd），如 scripts/report.py"),
      args: z.array(z.string()).default([]).describe("命令行参数"),
      input: z.string().default("").describe("stdin 输入（JSON 字符串）"),
      timeout: z.number().default(60).describe("超时秒数"),
      maxMemoryMb: z.number().default(256).describe("内存上限 MB"),
    }),
  }
);

// 执行 AI 生成的 Python 代码（沙箱隔离）
const runPythonTool = tool(
  async ({ code, timeout, maxMemoryMb }: { code: string; timeout: number; maxMemoryMb: number }) => {
    try {
      const check = await checkPythonSafety(code);
      if (!check.safe) {
        return JSON.stringify({ error: `代码被沙箱拒绝：${check.reason}` });
      }
      // 写到 data/sandbox/<uuid>.py 执行
      const sandboxRoot = resolve(config.dataDir, "sandbox");
      mkdirSync(sandboxRoot, { recursive: true });
      const filePath = join(sandboxRoot, `run_${Date.now()}.py`);
      writeFileSync(filePath, code, "utf8");
      try {
        return await runPython([filePath], sandboxRoot, { timeout, maxMemoryMb });
      } finally {
        rmSync(filePath, { force: true });
      }
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message });
    }
  },
  {
    name: "run_python",
    description:
      "执行用户提供的 Python 代码（沙箱隔离，禁止系统/网络/文件写入操作）。用于计算、数据处理等纯代码任务。返回 JSON {exitCode, stdout, stderr}。",
    schema: z.object({
      code: z.string().describe("要执行的 Python 代码"),
      timeout: z.number().default(30).describe("超时秒数"),
      maxMemoryMb: z.number().default(256).describe("内存上限 MB"),
    }),
  }
);

export function createBuiltinTools() {
  return [runScript, runPythonTool];
}
