// LLM provider 模块：路由
import type { FastifyInstance } from "fastify";
import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  setActiveProvider,
  setGlobalDefault,
  resetDefaultProvider,
  testProvider,
  getActiveProvider,
} from "./llm.service.js";
import { decryptKey } from "./llm.crypto.js";
import type { LlmProviderInput } from "@br-agent/shared";

export function registerLlmRoutes(app: FastifyInstance): void {
  // 列表（公共 + 当前用户私有）
  app.get("/api/llm/providers", async (request) => {
    const user = request.authUser!;
    return listProviders(user.username);
  });

  // 添加（公共仅管理员）
  app.post<{ Body: LlmProviderInput }>("/api/llm/providers", async (request, reply) => {
    const user = request.authUser!;
    try {
      return await createProvider(user.username, user.isAdmin, request.body ?? {});
    } catch (e) {
      const code = (e as { code?: number }).code ?? 400;
      reply.code(code).send({ error: (e as Error).message });
      return;
    }
  });

  // 修改
  app.patch<{ Params: { id: string }; Body: Partial<LlmProviderInput> }>(
    "/api/llm/providers/:id",
    async (request, reply) => {
      const user = request.authUser!;
      try {
        return await updateProvider(request.params.id, user.username, user.isAdmin, request.body ?? {});
      } catch (e) {
        const code = (e as { code?: number }).code ?? 400;
        reply.code(code).send({ error: (e as Error).message });
        return;
      }
    }
  );

  // 删除
  app.delete<{ Params: { id: string } }>("/api/llm/providers/:id", async (request, reply) => {
    const user = request.authUser!;
    try {
      await deleteProvider(request.params.id, user.username, user.isAdmin);
      return { ok: true };
    } catch (e) {
      const code = (e as { code?: number }).code ?? 400;
      reply.code(code).send({ error: (e as Error).message });
      return;
    }
  });

  // 设为当前用户默认（用户独立，不影响他人）
  app.post<{ Params: { id: string } }>("/api/llm/providers/:id/activate", async (request, reply) => {
    const user = request.authUser!;
    try {
      await setActiveProvider(request.params.id, user.username);
      return { ok: true };
    } catch (e) {
      const code = (e as { code?: number }).code ?? 400;
      reply.code(code).send({ error: (e as Error).message });
      return;
    }
  });

  // 恢复内置模型为默认（清空用户私有默认 → 回退公共全局默认）
  app.post("/api/llm/providers/reset", async (request) => {
    const user = request.authUser!;
    await resetDefaultProvider(user.username);
    return { ok: true };
  });

  // 管理员设置公共全局默认
  app.post<{ Params: { id: string } }>("/api/llm/providers/:id/global-default", async (request, reply) => {
    const user = request.authUser!;
    try {
      await setGlobalDefault(request.params.id, user.isAdmin);
      return { ok: true };
    } catch (e) {
      const code = (e as { code?: number }).code ?? 400;
      reply.code(code).send({ error: (e as Error).message });
      return;
    }
  });

  // 当前活动模型配置（含明文 apiKey，供桌面客户端本地创建 ChatOpenAI）
  app.get("/api/llm/providers/active-key", async (request, reply) => {
    const user = request.authUser!;
    const active = await getActiveProvider(user.username);
    if (!active) {
      reply.code(404).send({ error: "未配置可用模型" });
      return;
    }
    return { model: active.model, baseUrl: active.baseUrl, apiKey: decryptKey(active.apiKeyEnc) };
  });

  // 连接测试
  app.post<{ Params: { id: string } }>("/api/llm/providers/:id/test", async (request, reply) => {
    const user = request.authUser!;
    try {
      return await testProvider(request.params.id, user.username, user.isAdmin);
    } catch (e) {
      const code = (e as { code?: number }).code ?? 400;
      reply.code(code).send({ error: (e as Error).message });
      return;
    }
  });
}
