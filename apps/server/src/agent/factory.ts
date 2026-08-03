// Agent 工厂：根据配置创建 ChatOpenAI + langchain createAgent（ReAct 内核，v3 投影流）
// 说明：不用 deepagents 的 createDeepAgent —— 它会自动注入 filesystem/subagent/skills 中间件，
//      对本地 Qwen 造成干扰（模型陷入"探索文件系统"循环）。langchain createAgent 是同一内核，
//      同样支持 streamEvents v3（run.messages / run.toolCalls），但无侵入式中间件。
import { ChatOpenAI } from "@langchain/openai";
import { createAgent as createLcAgent } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { loadConfig } from "../config.js";

const config = loadConfig();

export interface LlmConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature?: number;
}

export function createChatModel(cfg: Partial<LlmConfig> = {}): BaseChatModel {
  return new ChatOpenAI({
    model: cfg.model ?? config.defaultModel,
    apiKey: cfg.apiKey ?? config.openaiApiKey,
    configuration: { baseURL: cfg.baseUrl ?? config.openaiBaseUrl },
    temperature: cfg.temperature ?? 0,
    // 必须开流式：关闭时 vLLM 攒满整条消息才返回，前端无法逐 token 渲染
    streaming: true,
  });
}

export interface CreateAgentOptions {
  model?: BaseChatModel;
  tools?: StructuredToolInterface[];
  systemPrompt: string;
}

export function createAgent(opts: CreateAgentOptions) {
  return createLcAgent({
    model: opts.model ?? createChatModel(),
    tools: (opts.tools ?? []) as never,
    systemPrompt: opts.systemPrompt,
  });
}
