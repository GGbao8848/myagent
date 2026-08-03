// 内置工具：脚本执行（供技能脚本调用）
import { tool } from "langchain";
import { z } from "zod";
import { spawn } from "node:child_process";
import { resolve, relative, join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../config.js";

const config = loadConfig();

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

// 运行技能目录内的 Python 脚本
const runScript = tool(
  async ({ cwd, script, args, input, timeout }: {
    cwd: string;
    script: string;
    args: string[];
    input: string;
    timeout: number;
  }) => {
    try {
      const scriptPath = safeResolve(cwd, script);
      const workdir = resolve(config.dataDir, cwd);
      if (!existsSync(scriptPath)) {
        return JSON.stringify({ error: `脚本不存在：${scriptPath}` });
      }
      return await new Promise<string>((resolvePromise) => {
        const proc = spawn("python", [scriptPath, ...args], {
          cwd: workdir,
          env: { ...process.env },
          shell: false,
        });
        let stdout = "";
        let stderr = "";
        let finished = false;
        const finish = (result: string) => {
          if (!finished) {
            finished = true;
            resolvePromise(result);
          }
        };
        const timer = setTimeout(() => {
          proc.kill();
          finish(JSON.stringify({ error: `脚本超时（${timeout}s）` }));
        }, (timeout ?? 60) * 1000);
        proc.stdout.on("data", (d) => (stdout += d.toString()));
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("close", (code) => {
          clearTimeout(timer);
          finish(JSON.stringify({ exitCode: code, stdout, stderr }));
        });
        proc.on("error", (e) => {
          clearTimeout(timer);
          finish(JSON.stringify({ error: e.message }));
        });
        if (input) {
          proc.stdin.write(input);
        }
        proc.stdin.end();
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
    }),
  }
);

export function createBuiltinTools() {
  return [runScript];
}
