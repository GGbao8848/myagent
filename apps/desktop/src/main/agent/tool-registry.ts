// 工具注册表（客户端）：注册本机工具（文件/命令/记忆）+ 本机 MCP，按安全分类供安全模式包装
// 注意：客户端本机操作已统一收敛到 mcp_local_*（经服务器代理到 agent-runtime，有白名单+审计日志），
//       不再注册本地直连工具（原 read_file/list_dir/write_file/delete_file/run_command 已移除，
//       避免与 mcp_local_* 功能重复且绕过安全策略）。
import type { StructuredToolInterface } from "@langchain/core/tools";
import { tool } from "langchain";
import { z } from "zod";
import type { ToolDef } from "./tool-manager.js";

export type ToolSecurity = "safe" | "dangerous";

export interface RegistryEntry {
  def: ToolDef;
  security: ToolSecurity;
}

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

// ── 客户端本机工具已统一收敛到 mcp_local_*，此处不再注册本地直连工具 ──
export function createClientToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
