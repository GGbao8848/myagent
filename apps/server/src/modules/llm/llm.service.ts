// LLM provider 服务：公共/私有双层 + 管理员权限 + apiKey 加密 + 用户独立默认模型
import { prisma } from "../../db/index.js";
import { encryptKey, decryptKey, maskKey } from "./llm.crypto.js";
import type { LlmProviderDto, LlmProviderInput, LlmProviderListDto } from "@br-agent/shared";

interface ProviderRow {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKeyEnc: string;
  owner: string;
  isGlobalDefault: boolean;
  maxTokens: number;
  createdAt: Date;
}

function toDto(p: ProviderRow): LlmProviderDto {
  return {
    id: p.id,
    name: p.name,
    model: p.model,
    baseUrl: p.baseUrl,
    apiKeyMasked: maskKey(decryptKey(p.apiKeyEnc)),
    owner: p.owner,
    isGlobalDefault: p.isGlobalDefault,
    maxTokens: p.maxTokens,
    createdAt: p.createdAt.toISOString(),
  };
}

/** 列表：公共 + 当前用户私有；activeProviderId = 用户默认；globalDefaultId = 公共全局默认 */
export async function listProviders(owner: string): Promise<LlmProviderListDto> {
  const [rows, def, globalDefault] = await Promise.all([
    prisma.llmProvider.findMany({
      where: { OR: [{ owner: "" }, { owner }] },
      orderBy: { createdAt: "desc" },
    }),
    prisma.userDefaultModel.findUnique({ where: { owner } }),
    prisma.llmProvider.findFirst({ where: { owner: "", isGlobalDefault: true } }),
  ]);
  return {
    providers: rows.map(toDto),
    activeProviderId: def?.providerId ?? null,
    globalDefaultId: globalDefault?.id ?? null,
  };
}

export async function createProvider(
  owner: string,
  isAdmin: boolean,
  input: LlmProviderInput
): Promise<LlmProviderDto> {
  const isPublic = !!input.public;
  if (isPublic && !isAdmin) {
    throw Object.assign(new Error("仅管理员可创建公共 provider"), { code: 403 });
  }
  if (!input.name?.trim() || !input.model?.trim() || !input.baseUrl?.trim()) {
    throw Object.assign(new Error("name / model / baseUrl 不能为空"), { code: 400 });
  }
  const row = await prisma.llmProvider.create({
    data: {
      name: input.name.trim(),
      model: input.model.trim(),
      baseUrl: input.baseUrl.trim(),
      apiKeyEnc: encryptKey(input.apiKey ?? ""),
      owner: isPublic ? "" : owner,
      isGlobalDefault: false,
      maxTokens: input.maxTokens ?? 32768,
    },
  });
  return toDto(row);
}

export async function updateProvider(
  id: string,
  owner: string,
  isAdmin: boolean,
  input: Partial<LlmProviderInput>
): Promise<LlmProviderDto> {
  const row = await prisma.llmProvider.findUnique({ where: { id } });
  if (!row) throw Object.assign(new Error("provider 不存在"), { code: 404 });
  // 权限：公共仅管理员；私有仅本人
  if (row.owner === "" && !isAdmin) throw Object.assign(new Error("无权限修改公共 provider"), { code: 403 });
  if (row.owner !== "" && row.owner !== owner) throw Object.assign(new Error("无权限修改该 provider"), { code: 403 });

  const data: Partial<typeof row> = {};
  if (input.name != null && input.name.trim()) data.name = input.name.trim();
  if (input.model != null && input.model.trim()) data.model = input.model.trim();
  if (input.baseUrl != null && input.baseUrl.trim()) data.baseUrl = input.baseUrl.trim();
  if (input.maxTokens != null) data.maxTokens = input.maxTokens;
  // apiKey 显式传入非空 → 重新加密（编辑时留空表示不修改）
  if (input.apiKey != null && input.apiKey !== "") data.apiKeyEnc = encryptKey(input.apiKey);

  const updated = await prisma.llmProvider.update({ where: { id }, data });
  return toDto(updated);
}

export async function deleteProvider(id: string, owner: string, isAdmin: boolean): Promise<void> {
  const row = await prisma.llmProvider.findUnique({ where: { id } });
  if (!row) throw Object.assign(new Error("provider 不存在"), { code: 404 });
  if (row.owner === "" && !isAdmin) throw Object.assign(new Error("无权限删除公共 provider"), { code: 403 });
  if (row.owner !== "" && row.owner !== owner) throw Object.assign(new Error("无权限删除该 provider"), { code: 403 });
  // 清理引用该 provider 的默认选择，避免悬空
  await prisma.userDefaultModel.deleteMany({ where: { providerId: id } });
  await prisma.llmProvider.delete({ where: { id } });
}

/** 管理员把某个公共 provider 设为全员默认（先清空其他公共默认标记） */
export async function setGlobalDefault(id: string, isAdmin: boolean): Promise<void> {
  if (!isAdmin) throw Object.assign(new Error("仅管理员可设置全局默认"), { code: 403 });
  const row = await prisma.llmProvider.findUnique({ where: { id } });
  if (!row) throw Object.assign(new Error("provider 不存在"), { code: 404 });
  if (row.owner !== "") throw Object.assign(new Error("仅公共 provider 可设为全局默认"), { code: 400 });
  await prisma.llmProvider.updateMany({ where: { owner: "" }, data: { isGlobalDefault: false } });
  await prisma.llmProvider.update({ where: { id }, data: { isGlobalDefault: true } });
}

/** 设为当前用户默认（用户独立，不影响他人）：写入 UserDefaultModel */
export async function setActiveProvider(id: string, owner: string): Promise<void> {
  const row = await prisma.llmProvider.findUnique({ where: { id } });
  if (!row) throw Object.assign(new Error("provider 不存在"), { code: 404 });
  // 公共 provider 任何用户可设为默认；私有仅本人
  if (row.owner !== "" && row.owner !== owner) {
    throw Object.assign(new Error("无权限使用该 provider"), { code: 403 });
  }
  await prisma.userDefaultModel.upsert({
    where: { owner },
    create: { owner, providerId: id },
    update: { providerId: id },
  });
}

/** 恢复内置模型为默认：删除当前用户的默认选择记录 */
export async function resetDefaultProvider(owner: string): Promise<void> {
  await prisma.userDefaultModel.deleteMany({ where: { owner } });
}

/**
 * 供对话：解析当前用户实际使用的 provider。三级优先级：
 * 1. 用户私有默认（UserDefaultModel）
 * 2. 公共全局默认（owner="" 且 isGlobalDefault）
 * 3. 都没有 → null（调用方报错，不再回退 env）
 */
export async function getActiveProvider(owner: string): Promise<{
  model: string;
  baseUrl: string;
  apiKeyEnc: string;
} | null> {
  // 1. 用户私有默认
  const def = await prisma.userDefaultModel.findUnique({ where: { owner } });
  if (def) {
    const row = await prisma.llmProvider.findUnique({ where: { id: def.providerId } });
    if (row) return { model: row.model, baseUrl: row.baseUrl, apiKeyEnc: row.apiKeyEnc };
  }
  // 2. 公共全局默认
  const global = await prisma.llmProvider.findFirst({ where: { owner: "", isGlobalDefault: true } });
  if (global) return { model: global.model, baseUrl: global.baseUrl, apiKeyEnc: global.apiKeyEnc };
  return null;
}

/** 连接测试：用 baseUrl 探测模型可达性（发一个极短的 chat 请求） */
export async function testProvider(id: string, owner: string, isAdmin: boolean): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.llmProvider.findUnique({ where: { id } });
  if (!row) throw Object.assign(new Error("provider 不存在"), { code: 404 });
  if (row.owner !== "" && row.owner !== owner) {
    throw Object.assign(new Error("无权限测试该 provider"), { code: 403 });
  }
  if (row.owner === "" && !isAdmin && row.owner !== owner) {
    // 非管理员测试公共 provider：允许只读探测（不发真实 key）
  }
  try {
    const apiKey = decryptKey(row.apiKeyEnc);
    const resp = await fetch(`${row.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: row.model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
      }),
    });
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
