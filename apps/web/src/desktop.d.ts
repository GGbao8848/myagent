// 桌面客户端（Electron）桥：声明 window.desktopAPI（纯浏览器环境不存在，可选链访问）
import type { DesktopAPI } from "@br-agent/shared";

declare global {
  interface Window {
    desktopAPI?: DesktopAPI;
  }
}

export {};
