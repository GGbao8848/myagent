// 用户记忆画像服务：观察存储 + 对话异步提取 + 注入对话
import { prisma } from "../../db/index.js";
import { getActiveProvider } from "../llm/llm.service.js";
import { decryptKey } from "../llm/llm.crypto.js";
import { createChatModel } from "../../agent/factory.js";
import type { ProfileObservationDto } from "@br-agent/shared";

const MAX_PROMPT_OBSERVATIONS = 15;
const AUTO_CONFIDENCE = 0.4;
const EXPLICIT_CONFIDENCE = 0.8;
const CONFIDENCE_STEP = 0.1;
const CONFIDENCE_MAX = 0.95;
const CONFIDENCE_MIN = 0.1;
const DECAY_PER_DAY = 0.05; // 置信度衰减：5%/天
const SIMILARITY_THRESHOLD = 0.6; // 相似去重阈值
const INJECT_MIN_CONFIDENCE = 0.5; // 注入对话的最低置信度

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

/** 置信度时间衰减：距 lastSeenAt 每过一天降 5%，最低 CONFIDENCE_MIN */
async function decayObservations(owner: string): Promise<void> {
  const rows = await prisma.profileObservation.findMany({ where: { owner } });
  const now = Date.now();
  for (const r of rows) {
    const days = (now - r.lastSeenAt.getTime()) / 86400000;
    if (days > 1) {
      const newC = Math.max(CONFIDENCE_MIN, r.confidence - days * DECAY_PER_DAY);
      await prisma.profileObservation.update({
        where: { id: r.id },
        data: { confidence: Math.round(newC * 100) / 100 },
      });
    }
  }
}

/** 字符集 Jaccard 相似度：归一化后计算字符重叠比例 */
function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[\s，。！？、：；,.!?]/g, "");
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  const sa = new Set(na);
  const sb = new Set(nb);
  let inter = 0;
  for (const c of sa) if (sb.has(c)) inter++;
  return inter / Math.max(sa.size, sb.size);
}

/** 新增观察（手动或提取共用）；精确匹配 → 相似匹配 → 新建 */
export async function createObservation(
  owner: string,
  content: string,
  source: "explicit" | "auto" = "explicit"
): Promise<ProfileObservationDto> {
  const trimmed = content.trim();
  if (!trimmed) throw Object.assign(new Error("观察内容不能为空"), { code: 400 });

  // 1. 精确匹配
  const exact = await prisma.profileObservation.findFirst({
    where: { owner, content: trimmed },
  });
  if (exact) return bumpObservation(exact);

  // 2. 相似匹配（归一化字符集 Jaccard >= 阈值）
  const all = await prisma.profileObservation.findMany({ where: { owner } });
  const similar = all.find((r) => similarity(trimmed, r.content) >= SIMILARITY_THRESHOLD);
  if (similar) return bumpObservation(similar);

  // 3. 新建
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

/** 观察重复/相似出现：seenCount+1、confidence 提升、lastSeenAt 更新 */
async function bumpObservation(row: Row): Promise<ProfileObservationDto> {
  const updated = await prisma.profileObservation.update({
    where: { id: row.id },
    data: {
      seenCount: row.seenCount + 1,
      confidence: Math.min(CONFIDENCE_MAX, row.confidence + CONFIDENCE_STEP),
      lastSeenAt: new Date(),
      enabled: true,
    },
  });
  return toDto(updated);
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

/** 供对话注入：只注入高置信度且最近活跃的观察，按 置信度×活跃度 排序 */
export async function getProfilePrompt(owner: string): Promise<string> {
  const rows = await prisma.profileObservation.findMany({
    where: { owner, enabled: true, confidence: { gte: INJECT_MIN_CONFIDENCE } },
  });
  if (rows.length === 0) return "";
  const now = Date.now();
  const scored = rows
    .map((r) => {
      const days = (now - r.lastSeenAt.getTime()) / 86400000;
      const recency = 1 / (1 + days);
      return { r, score: r.confidence * recency };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PROMPT_OBSERVATIONS);
  if (scored.length === 0) return "";
  const lines = scored.map(({ r }) => `- ${r.content}`).join("\n");
  return `\n\n## 用户偏好（记忆）\n根据历史对话积累的对该用户的了解，回答时尽量贴合：\n${lines}`;
}

/** agent 成功调用凭据后强化记忆：把含该账号/密码的观察提升到注入阈值以上并刷新活跃度，保证多轮对话持续可用 */
export async function strengthenCredentialMemory(
  owner: string,
  username: string,
  password: string
): Promise<void> {
  const markers = [username, password].filter(Boolean);
  if (markers.length === 0) return;
  try {
    const rows = await prisma.profileObservation.findMany({ where: { owner, enabled: true } });
    let hit = false;
    for (const r of rows) {
      if (markers.some((m) => r.content.includes(m))) {
        const newC = Math.min(CONFIDENCE_MAX, Math.max(INJECT_MIN_CONFIDENCE + 0.15, r.confidence + 0.3));
        await prisma.profileObservation.update({
          where: { id: r.id },
          data: { confidence: newC, lastSeenAt: new Date(), seenCount: r.seenCount + 1 },
        });
        hit = true;
      }
    }
    // 无匹配观察：agent 已验证凭据可用，直接落一条高置信度记忆
    if (!hit && username && password) {
      await prisma.profileObservation
        .create({
          data: {
            owner,
            content: `用户BIP账号${username}，密码${password}`,
            confidence: 0.9,
            source: "auto",
          },
        })
        .catch(() => {});
    }
  } catch {
    // 强化失败静默，不影响对话主流程
  }
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
    // 提取前：置信度衰减（长期未见的观察权重下降）
    await decayObservations(owner);
    // 拼接最近对话（截断，避免过长）
    const recent = conversation.slice(-10)
      .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content.slice(0, 300)}`)
      .join("\n");
    const prompt =
      "从下面的对话中提取关于用户的持久偏好或事实（如喜欢简洁回复、习惯用某工具、身份信息等）。" +
      "只提取用户明确表达、多次出现或可长期使用的偏好；忽略一次性的请求、情绪表达、寒暄和无关内容。" +
      "最多提取 5 条。不要输出思考过程、解释或示例，只输出一个 JSON 字符串数组。" +
      "注意：绝对不要把占位示例（如\"偏好A\"、\"事实B\"）作为提取结果输出。\n\n对话：\n" + recent;
    const result = await model.invoke([{ role: "user", content: prompt }] as never);
    const text = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
    const parsed = parseObservations(text);
    let count = 0;
    for (const obs of parsed) {
      if (!obs) continue;
      // 过滤空泛/过短内容
      if (obs.length < 4 || isVague(obs)) continue;
      const created = await createObservation(owner, obs, "auto").catch(() => null);
      if (created && created.confidence >= AUTO_CONFIDENCE) count++;
    }
    if (count > 0) {
      console.log(`[profile] ${owner} 提取 ${count} 条观察`);
    }
  } catch (e) {
    console.error(`[profile] ${owner} 提取观察失败:`, (e as Error).message);
  }
}

/** 空泛内容过滤：无具体信息的表达不提取 */
function isVague(s: string): boolean {
  const vague = ["用户很好", "用户不错", "用户友好", "用户正常", "好的", "可以", "谢谢", "没问题", "知道了", "用户开心", "用户满意"];
  // 占位/示例模式（LLM 偶发把输出格式示例当结果返回）：偏好A/事实B/偏好X/事实Y 等
  if (/^(偏好|事实|喜好|习惯|身份|信息)[A-Za-z0-9_一-龥]{0,2}$/.test(s)) return true;
  return vague.some((v) => s.includes(v)) || /^(用户|我)(是|叫|在|有)?[一-龥]{0,3}$/.test(s);
}

/** 解析 LLM 输出的 JSON 数组；容错多种格式（LLM 常混入思考过程） */function parseObservations(text: string): string[] {
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
