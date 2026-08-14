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
    // 显式异常参数：单次请求 120s 超时（与 runner 单轮护栏一致）；
    // maxRetries=0 避免内部重试把超时时长叠加成数分钟；maxConcurrency=1 串行防并发
    timeout: 120_000,
    maxRetries: 0,
    maxConcurrency: 1,
  });
}
