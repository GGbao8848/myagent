// 用户记忆画像服务：观察存储 + 对话异步提取 + 注入对话
import { prisma } from "../../db/index.js";
import { getActiveProvider } from "../llm/llm.service.js";
import { decryptKey } from "../llm/llm.crypto.js";
import { createChatModel } from "../../agent/factory.js";
import type { ProfileObservationDto } from "@br-agent/shared";

const MAX_PROMPT_OBSERVATIONS = 20;
const AUTO_CONFIDENCE = 0.4;
const EXPLICIT_CONFIDENCE = 0.8;
const CONFIDENCE_STEP = 0.1;
const CONFIDENCE_MAX = 0.95;

interface Row {
  id: string;
  owner: string;
  content: string;
  confidence: number;
  source: string;
  enabled: boolean;
  seenCount: number;
  createdAt: Date;
  lastSeenAt: Date;
}

function toDto(r: Row): ProfileObservationDto {
  return {
    id: r.id,
    content: r.content,
    confidence: r.confidence,
    source: r.source,
    enabled: r.enabled,
    seenCount: r.seenCount,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  };
}

export async function listObservations(owner: string): Promise<ProfileObservationDto[]> {
  const rows = await prisma.profileObservation.findMany({
    where: { owner },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDto);
}

/** 新增观察（手动或提取共用）；同内容已存在 → seenCount+1、confidence 提升 */
export async function createObservation(
  owner: string,
  content: string,
  source: "explicit" | "auto" = "explicit"
): Promise<ProfileObservationDto> {
  const trimmed = content.trim();
  if (!trimmed) throw Object.assign(new Error("观察内容不能为空"), { code: 400 });

  const existing = await prisma.profileObservation.findFirst({
    where: { owner, content: trimmed },
  });
  if (existing) {
    const updated = await prisma.profileObservation.update({
      where: { id: existing.id },
      data: {
        seenCount: existing.seenCount + 1,
        confidence: Math.min(CONFIDENCE_MAX, existing.confidence + CONFIDENCE_STEP),
        lastSeenAt: new Date(),
        enabled: true,
      },
    });
    return toDto(updated);
  }
  const row = await prisma.profileObservation.create({
    data: {
      owner,
      content: trimmed,
      confidence: source === "explicit" ? EXPLICIT_CONFIDENCE : AUTO_CONFIDENCE,
      source,
    },
  });
  return toDto(row);
}

export async function updateObservation(
  id: string,
  owner: string,
  patch: { content?: string; confidence?: number; enabled?: boolean }
): Promise<ProfileObservationDto> {
  const row = await prisma.profileObservation.findFirst({ where: { id, owner } });
  if (!row) throw Object.assign(new Error("观察不存在"), { code: 404 });
  const data: Partial<Row> = {};
  if (patch.content != null && patch.content.trim()) data.content = patch.content.trim();
  if (patch.confidence != null) {
    const c = Math.max(0, Math.min(1, patch.confidence));
    data.confidence = c;
  }
  if (patch.enabled != null) data.enabled = patch.enabled;
  const updated = await prisma.profileObservation.update({ where: { id }, data });
  return toDto(updated);
}

export async function deleteObservation(id: string, owner: string): Promise<void> {
  const row = await prisma.profileObservation.findFirst({ where: { id, owner } });
  if (!row) throw Object.assign(new Error("观察不存在"), { code: 404 });
  await prisma.profileObservation.delete({ where: { id } });
}

/** 供对话注入：读取该用户启用的观察，拼接为 systemPrompt 片段 */
export async function getProfilePrompt(owner: string): Promise<string> {
  const rows = await prisma.profileObservation.findMany({
    where: { owner, enabled: true },
    orderBy: [{ confidence: "desc" }, { lastSeenAt: "desc" }],
    take: MAX_PROMPT_OBSERVATIONS,
  });
  if (rows.length === 0) return "";
  const lines = rows.map((r) => `- ${r.content}`).join("\n");
  return `\n\n## 用户偏好（记忆）\n根据历史对话积累的对该用户的了解，回答时尽量贴合：\n${lines}`;
}

/**
 * 对话后异步提取用户偏好观察。
 * 用用户默认 provider 非流式调用 LLM，从最近对话提取观察，写入 DB。
 * 失败静默（不抛错，避免影响对话主流程）。
 */
export async function extractObservationsAsync(
  owner: string,
  conversation: Array<{ role: string; content: string }>
): Promise<void> {
  try {
    const active = await getActiveProvider(owner);
    if (!active) return; // 无可用模型，不提取（静默）
    const model = createChatModel(
      active
        ? { model: active.model, baseUrl: active.baseUrl, apiKey: active.apiKeyEnc ? decryptKey(active.apiKeyEnc) : undefined }
        : {}
    );
    // 提取设超时（30s），避免卡住后台任务
    (model as unknown as { timeout?: number }).timeout = 30_000;
    // 拼接最近对话（截断，避免过长）
    const recent = conversation.slice(-10)
      .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content.slice(0, 300)}`)
      .join("\n");
    const prompt =
      "从下面的对话中提取关于用户的持久偏好或事实（如喜欢简洁回复、习惯用某工具、身份信息等）。" +
      "忽略一次性请求。不要输出任何思考过程或解释，只输出一个 JSON 字符串数组，如 [\"偏好A\", \"事实B\"]。\n\n对话：\n" + recent;
    const result = await model.invoke([{ role: "user", content: prompt }] as never);
    const text = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
    const parsed = parseObservations(text);
    for (const obs of parsed) {
      if (!obs) continue;
      await createObservation(owner, obs, "auto").catch(() => {});
    }
    if (parsed.length > 0) {
      console.log(`[profile] ${owner} 提取 ${parsed.length} 条观察`);
    }
  } catch (e) {
    console.error(`[profile] ${owner} 提取观察失败:`, (e as Error).message);
  }
}

/** 解析 LLM 输出的 JSON 数组；容错多种格式（LLM 常混入思考过程） */
function parseObservations(text: string): string[] {
  try {
    // 先找所有 JSON 数组片段，取最后那个能解析且内容为字符串数组的
    const matches = [...text.matchAll(/\[[\s\S]*?\]/g)];
    for (let i = matches.length - 1; i >= 0; i--) {
      try {
        const arr = JSON.parse(matches[i][0]);
        if (Array.isArray(arr)) {
          const strs = arr
            .map((x: unknown) => (typeof x === "string" ? x : x && typeof x === "object" ? String((x as { content?: unknown }).content ?? "") : ""))
            .map((s: string) => s.trim())
            .filter(Boolean);
          if (strs.length > 0) return strs;
        }
      } catch {
        /* 尝试下一个 */
      }
    }
    return [];
  } catch {
    return [];
  }
}
