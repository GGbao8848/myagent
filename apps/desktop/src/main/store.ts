// 本地设置：服务器地址等
import { app } from "electron";

/** 打包时默认服务器地址（CS 模式：直连后端 API 端口 9004；按部署修改后重新打包；客户端零配置） */
export const DEFAULT_SERVER_URL = "http://10.1.20.132:9004";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { DesktopSettings } from "@br-agent/shared";

/** 打包时预设的服务器地址（electron-builder extraResources 放入 resources/default-settings.json） */
export function readPresetServerUrl(): string {
  try {
    const parsed = JSON.parse(readFileSync(join(process.resourcesPath, "default-settings.json"), "utf-8")) as {
      serverUrl?: string;
    };
    return parsed?.serverUrl?.trim() ?? "";
  } catch {
    return "";
  }
}

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

export const settingsStore = {
  get(): DesktopSettings {
    try {
      const raw = readFileSync(settingsPath(), "utf-8");
      const parsed = JSON.parse(raw) as DesktopSettings;
      if (parsed && typeof parsed.serverUrl === "string") return { serverUrl: parsed.serverUrl };
    } catch {
      // 首启/损坏时用默认
    }
    return {};
  },
  save(s: DesktopSettings): void {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2), "utf-8");
  },
};
