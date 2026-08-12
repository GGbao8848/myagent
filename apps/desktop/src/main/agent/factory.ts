// LLM 工厂（客户端版）：从服务器 active-key 配置本地创建 ChatOpenAI
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface LlmConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature?: number;
}

export function createChatModel(cfg: LlmConfig): BaseChatModel {
  return new ChatOpenAI({
    model: cfg.model,
    apiKey: cfg.apiKey,
    configuration: { baseURL: cfg.baseUrl },
    temperature: cfg.temperature ?? 0,
    // 必须开流式：关闭时 LLM 攒满整条消息才返回，前端无法逐 token 渲染
    streaming: true,
  });
}
