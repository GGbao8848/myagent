// 连接设置：配置 BR-Agent 服务器地址（保存后主进程更新 API base）
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [serverUrl, setServerUrl] = useState("");

  useEffect(() => {
    window.electronAPI
      ?.getSettings()
      .then((s) => setServerUrl(s.serverUrl ?? ""))
      .catch(() => {});
  }, []);

  const save = async () => {
    try {
      const r = await window.electronAPI!.saveSettings({ serverUrl });
      if (r.ok) {
        toast.success("已保存服务器地址");
        onClose();
      } else {
        toast.error(r.error || "保存失败");
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>连接设置</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="!block text-xs text-muted-foreground mb-1">服务器地址</Label>
            <Input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.100:9005"
            />
          </div>
          <p className="text-xs text-muted-foreground">BR-Agent 服务器地址（web 端地址），认证与数据都走该服务器。</p>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
