import type { DesktopAPI } from "@br-agent/shared";

declare global {
  interface Window {
    desktopAPI?: DesktopAPI;
  }
}

export {};
