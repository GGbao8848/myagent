// token 持久化：safeStorage（Windows DPAPI）加密写盘
import { app, safeStorage } from "electron";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface StoredTokens {
  access: string;
  refresh: string;
}

function tokenPath(): string {
  return join(app.getPath("userData"), "tokens.bin");
}

export const tokenStore = {
  save(t: StoredTokens): void {
    try {
      const enc = safeStorage.encryptString(JSON.stringify(t));
      writeFileSync(tokenPath(), enc);
    } catch {
      // 加密失败忽略（如无可用加密）
    }
  },
  load(): StoredTokens | null {
    try {
      if (!existsSync(tokenPath())) return null;
      const buf = readFileSync(tokenPath());
      const dec = safeStorage.decryptString(buf);
      const parsed = JSON.parse(dec) as Partial<StoredTokens>;
      if (parsed && typeof parsed.access === "string") return { access: parsed.access, refresh: parsed.refresh ?? "" };
    } catch {
      // 解密失败视为无 token
    }
    return null;
  },
  clear(): void {
    try {
      writeFileSync(tokenPath(), Buffer.alloc(0));
    } catch {
      /* 忽略 */
    }
  },
};
