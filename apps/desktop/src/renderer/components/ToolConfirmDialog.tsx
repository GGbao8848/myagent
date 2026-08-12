// 工具执行确认弹窗：主进程工具执行前发 agent:tool:confirm，这里弹窗让用户允许/拒绝
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ConfirmData {
  callId: string;
  tool_name: string;
  args: unknown;
  security: string;
}

export function ToolConfirmDialog() {
  const [pending, setPending] = useState<ConfirmData | null>(null);

  useEffect(() => {
    const off = window.electronAPI?.onToolConfirm((data) => setPending(data as ConfirmData));
    return () => {
      off?.();
    };
  }, []);

  const respond = (approved: boolean) => {
    if (pending) window.electronAPI?.toolConfirmResponse(pending.callId, approved);
    setPending(null);
  };

  return (
    <Dialog open={!!pending} onOpenChange={(o) => { if (!o) respond(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>⚠️ 工具执行确认</DialogTitle>
        </DialogHeader>
        {pending && (
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">工具：</span>
              <code className="font-mono text-foreground">{pending.tool_name}</code>
              {pending.security === "dangerous" && (
                <span className="ml-2 text-xs text-destructive">（危险操作）</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">参数：</span>
              <pre className="mt-1 bg-muted rounded-md p-2 text-xs overflow-x-auto">
                {JSON.stringify(pending.args, null, 2)}
              </pre>
            </div>
            <p className="text-muted-foreground text-xs">该操作将在你的本机执行。是否允许？</p>
          </div>
        )}
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => respond(false)}>拒绝</Button>
          <Button onClick={() => respond(true)}>允许</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
