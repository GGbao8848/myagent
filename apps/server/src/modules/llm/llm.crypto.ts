// LLM provider apiKey 加密：AES-256-GCM
// 密钥来自 env ENCRYPTION_KEY（32 字节）；缺省用开发默认值（生产必须配置）
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
// 固定 32 字节密钥（开发默认值仅用于本地，生产通过 ENCRYPTION_KEY 覆盖）
function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? "br-agent-dev-key-change-me-32bytes!!";
  return Buffer.from(raw.padEnd(32, "x").slice(0, 32), "utf8");
}

/** 加密 → "iv:authTag:ciphertext"（均 base64）。空串原样返回。 */
export function encryptKey(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${enc.toString("base64")}`;
}

/** 解密 encryptKey 输出。空串或解密失败返回 ""（失败不抛错，便于降级）。 */
export function decryptKey(enc: string): string {
  if (!enc) return "";
  try {
    const [ivB64, tagB64, dataB64] = enc.split(":");
    if (!ivB64 || !tagB64 || !dataB64) return "";
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

/** 脱敏 apiKey：保留前 4 位 + 后 4 位，中间用 ***（如 sk-***abc）。 */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}
