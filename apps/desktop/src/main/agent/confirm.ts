// 工具确认队列：工具执行前向渲染进程发确认请求，等待用户批准/拒绝
import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import type { ToolSecurity } from "./tool-registry.js";

export class ConfirmQueue {
  private pending = new Map<string, (approved: boolean) => void>();

  constructor(private win: BrowserWindow) {}

  request(name: string, args: unknown, security: ToolSecurity): Promise<boolean> {
    const callId = randomUUID();
    return new Promise((resolve) => {
      if (this.win.isDestroyed()) {
        resolve(false);
        return;
      }
      this.pending.set(callId, resolve);
      this.win.webContents.send("agent:tool:confirm", { callId, tool_name: name, args, security });
    });
  }

  respond(callId: string, approved: boolean): void {
    const resolve = this.pending.get(callId);
    if (resolve) {
      this.pending.delete(callId);
      resolve(approved);
    }
  }
}
