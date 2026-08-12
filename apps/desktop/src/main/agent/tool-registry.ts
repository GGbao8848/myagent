// 工具注册表（客户端）：注册本机工具（文件/命令/记忆）+ 本机 MCP，按安全分类供安全模式包装
import type { StructuredToolInterface } from "@langchain/core/tools";
import { tool } from "langchain";
import { z } from "zod";
import { app } from "electron";
import type { ToolDef } from "./tool-manager.js";

export type ToolSecurity = "safe" | "dangerous";

export interface RegistryEntry {
  def: ToolDef;
  security: ToolSecurity;
}

const WORKSPACE = process.env.BR_AGENT_WORKSPACE || process.cwd();

export class ToolRegistry {
  private entries = new Map<string, RegistryEntry>();

  register(def: ToolDef, security: ToolSecurity): void {
    this.entries.set(def.name, { def, security });
  }

  /** 转为 langchain 工具；dangerous 工具可选地包一层确认（confirm 返回 false 则拒绝执行） */
  listWithSecurity(shouldConfirm: (name: string, security: ToolSecurity) => boolean, onConfirm?: (name: string, args: unknown, security: ToolSecurity) => Promise<boolean>): StructuredToolInterface[] {
    return [...this.entries.values()].map(({ def, security }) => {
      const needsConfirm = shouldConfirm(def.name, security);
      const execute = async (args: unknown): Promise<unknown> => {
        if (needsConfirm && onConfirm) {
          const ok = await onConfirm(def.name, args, security);
          if (!ok) throw new Error(`用户拒绝了工具 ${def.name} 的执行`);
        }
        return def.execute(args);
      };
      return tool(execute, {
        name: def.name,
        description: def.description,
        schema: def.schema as never,
      });
    });
  }

  listAll(): Array<{ name: string; security: ToolSecurity }> {
    return [...this.entries.values()].map(({ def, security }) => ({ name: def.name, security }));
  }
}

// ── 内置工具：工作区限定（防越界） ──

/** 本地同步的技能目录（agent 需要读取 skill 脚本/配置，工作区之外也放行） */
function skillRoot(): string {
  return require("node:path").join(app.getPath("userData"), "skills");
}

function resolveSafe(p: string): string {
  const target = require("node:path").resolve(p);
  const root = WORKSPACE;
  const sroot = skillRoot();
  const inRoot = target === root || target.startsWith(root + "\\") || target.startsWith(root + "/");
  const inSkill = target === sroot || target.startsWith(sroot + "\\") || target.startsWith(sroot + "/");
  if (!inRoot && !inSkill) {
    throw new Error(`路径超出工作区：${target}`);
  }
  return target;
}

function registerBuiltin(reg: ToolRegistry): void {
  const fs = require("node:fs");
  const path = require("node:path");

  reg.register(
    {
      name: "read_file",
      description: "读取工作区内文件内容",
      schema: z.object({ path: z.string() }),
      execute: async (args) => {
        const p = resolveSafe((args as { path: string }).path);
        const content = fs.readFileSync(p, "utf-8");
        return content.length > 20000 ? content.slice(0, 20000) + "\n...(已截断)" : content;
      },
    },
    "safe"
  );

  reg.register(
    {
      name: "list_dir",
      description: "列出工作区内目录的文件与子目录",
      schema: z.object({ path: z.string().optional() }),
      execute: async (args) => {
        const p = resolveSafe((args as { path?: string }).path ?? ".");
        return fs
          .readdirSync(p, { withFileTypes: true })
          .map((e: { isDirectory(): boolean; name: string }) => `${e.isDirectory() ? "[d]" : "[f]"} ${e.name}`)
          .join("\n");
      },
    },
    "safe"
  );

  reg.register(
    {
      name: "write_file",
      description: "写入文件到工作区（覆盖）",
      schema: z.object({ path: z.string(), content: z.string() }),
      execute: async (args) => {
        const a = args as { path: string; content: string };
        const p = resolveSafe(a.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, a.content, "utf-8");
        return `已写入 ${p}（${Buffer.byteLength(a.content)} 字节）`;
      },
    },
    "dangerous"
  );

  reg.register(
    {
      name: "delete_file",
      description: "删除工作区内文件",
      schema: z.object({ path: z.string() }),
      execute: async (args) => {
        const p = resolveSafe((args as { path: string }).path);
        fs.rmSync(p, { recursive: true, force: true });
        return `已删除 ${p}`;
      },
    },
    "dangerous"
  );

  reg.register(
    {
      name: "run_command",
      description: "在工作区执行一条 shell 命令并返回输出",
      schema: z.object({ command: z.string() }),
      execute: async (args) => {
        const { execFile } = require("node:child_process");
        const rawCmd = (args as { command: string }).command;
        // Windows 下先切到 UTF-8 代码页，避免命令输出 GBK 乱码让 agent 读不懂
        const cmd = process.platform === "win32" ? `chcp 65001 >nul & ${rawCmd}` : rawCmd;
        return new Promise<string>((resolve, reject) => {
          const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
          const shellArgs = process.platform === "win32" ? ["/c", cmd] : ["-c", cmd];
          execFile(shell, shellArgs, { cwd: WORKSPACE, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }, (err: unknown, stdout: string, stderr: string) => {
            const out = `${stdout}${stderr}`.trim();
            if (err && !out) reject(new Error(String(err)));
            else resolve(out || "(无输出)");
          });
        });
      },
    },
    "dangerous"
  );
}

export function createClientToolRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  registerBuiltin(reg);
  return reg;
}
