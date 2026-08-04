// ToolManager：统一工具注册中心 + 超时/重试网关
import { tool } from "langchain";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { createBuiltinTools } from "./tools.js";
import { getEnabledMcpTools } from "../modules/mcp/mcp.service.js";

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
  timeoutMs?: number; // 该工具超时（毫秒）
  maxRetries?: number; // 失败重试次数
  execute: (args: unknown) => Promise<unknown>;
}

export class ToolManager {
  private defs = new Map<string, ToolDef>();

  register(def: ToolDef): void {
    this.defs.set(def.name, def);
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  /** 转为 langchain 工具数组（供 createAgent） */
  list(): StructuredToolInterface[] {
    return [...this.defs.values()].map((d) =>
      tool(
        async (args) => {
          return this.executeWithGuard(d, args);
        },
        {
          name: d.name,
          description: d.description,
          schema: d.schema as never,
        }
      )
    );
  }

  private async executeWithGuard(def: ToolDef, args: unknown): Promise<unknown> {
    const retries = def.maxRetries ?? 1;
    let lastError: unknown;
    for (let i = 0; i < retries; i++) {
      try {
        return await this.withTimeout(def, args);
      } catch (e) {
        lastError = e;
        if (i < retries - 1) {
          // 重试前短暂等待
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }
    throw lastError;
  }

  private withTimeout(def: ToolDef, args: unknown): Promise<unknown> {
    const timeoutMs = def.timeoutMs ?? 60_000;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        rejectPromise(new Error(`工具 ${def.name} 执行超时（${timeoutMs}ms）`));
      }, timeoutMs);
      Promise.resolve(def.execute(args)).then(
        (v) => {
          clearTimeout(timer);
          resolvePromise(v);
        },
        (e) => {
          clearTimeout(timer);
          rejectPromise(e);
        }
      );
    });
  }
}

/** 创建注入 agent 的完整工具数组：内置（run_script/run_python）+ 用户启用 MCP 工具 */
export async function createAgentTools(userId: string): Promise<StructuredToolInterface[]> {
  const builtin = createBuiltinTools();
  const mcpTools = await getEnabledMcpTools(userId);
  return [...builtin, ...mcpTools];
}
