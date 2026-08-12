// 客户端能力网关：客户端工具 → langchain 转发工具
// 把桌面客户端上报的工具包装成 langchain 工具注入 agent；执行时经 WS 转发到客户端本机。
import { tool } from "langchain";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { invokeTool } from "./registry.js";
import type { ClientToolSchema } from "./types.js";

/**
 * 把客户端上报的工具包装成 langchain 工具注入 agent。
 * - 工具名加 local_ 前缀，避免与后端 MCP 工具冲突
 * - 完整 JSON Schema 内嵌到 description，供 LLM 生成正确参数
 * - zod 用宽松 passthrough（实际参数校验在客户端本机执行时完成）
 */
export function createClientTool(schema: ClientToolSchema, username: string): StructuredToolInterface {
  const description = `${schema.description}\n\n[本机客户端工具 · 在用户本地电脑执行]\n参数规格 (JSON Schema):\n${JSON.stringify(schema.jsonSchema)}`;
  return tool(
    async (args) => invokeTool(username, schema.name, args as Record<string, unknown>),
    {
      name: `local_${schema.name}`,
      description,
      schema: z.object({}).passthrough(),
    }
  );
}
