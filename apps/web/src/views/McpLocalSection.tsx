// 本机工具（桌面客户端）：经 window.desktopAPI 桥读写 Electron 主进程的本机 MCP 配置。
// 仅桌面客户端环境（window.desktopAPI 存在）渲染；纯浏览器访问不显示。
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Laptop, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import type { DesktopMcpConfig, DesktopMcpServerEntry, DesktopStatus } from "@br-agent/shared";

export default function McpLocalSection() {
  const [config, setConfig] = useState<DesktopMcpConfig>({ servers: [] });
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DesktopMcpServerEntry | null>(null);

  const refresh = useCallback(async () => {
    const api = window.desktopAPI;
    if (!api) return;
    try {
      const [cfg, st] = await Promise.all([api.getMcpConfig(), api.getStatus()]);
      setConfig(cfg);
      setStatus(st);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 轻量轮询连接状态：登录后 token 同步 → WS 连接，页面自动从「未连接」刷新为「已连接」
  const refreshStatus = useCallback(async () => {
    const api = window.desktopAPI;
    if (!api) return;
    try {
      setStatus(await api.getStatus());
    } catch {
      /* 忽略轮询错误 */
    }
  }, []);

  useEffect(() => {
    if (!window.desktopAPI) {
      setLoading(false);
      return;
    }
    void refresh();
    const timer = setInterval(() => {
      void refreshStatus();
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh, refreshStatus]);

  const save = async (servers: DesktopMcpServerEntry[]) => {
    try {
      const r = await window.desktopAPI!.updateMcpConfig({ servers });
      setConfig({ servers });
      await refresh();
      if (r.errors.length) toast.error(`部分服务器加载失败：${r.errors.join("; ")}`);
      else toast.success(`已保存，注册 ${r.toolsCount} 个本机工具`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const toggle = (s: DesktopMcpServerEntry) => {
    save(config.servers.map((x) => (x.name === s.name ? { ...x, enabled: !x.enabled } : x)));
  };

  const remove = (name: string) => {
    if (!confirm(`确定删除本机工具「${name}」？`)) return;
    save(config.servers.filter((x) => x.name !== name));
  };

  const handleSubmitServer = (server: DesktopMcpServerEntry) => {
    const exists = config.servers.some((x) => x.name === server.name);
    save(exists ? config.servers.map((x) => (x.name === server.name ? server : x)) : [...config.servers, server]);
  };

  if (!window.desktopAPI) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Laptop className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">本机工具（桌面客户端）</h3>
          {status && (
            <span className="text-xs text-muted-foreground">
              <span
                className={`inline-block size-2 rounded-full mr-1 ${status.connected ? "bg-green-500" : "bg-red-500"}`}
              />
              {status.connected ? `已连接 · ${status.toolsCount} 个工具` : "未连接后端"}
            </span>
          )}
        </div>
        <Button size="sm" onClick={() => { setEditTarget(null); setModalOpen(true); }}>
          <Plus className="size-3.5 mr-1" /> 添加本机 MCP
        </Button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" /> 读取本机配置…
        </div>
      ) : config.servers.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3">
          尚未配置本机 MCP。添加 stdio / HTTP 服务器后，对话中 agent 即可调用——stdio 型将直接在你本机执行。
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {config.servers.map((s) => (
            <Card key={s.name}>
              <CardContent className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground text-sm">{s.name}</span>
                    <Badge variant="secondary">{s.type}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                    {s.type === "stdio" ? `${s.command} ${(s.args ?? []).join(" ")}` : s.url}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <Switch checked={s.enabled} onCheckedChange={() => toggle(s)} aria-label={`启用 ${s.name}`} />
                  <button
                    className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
                    aria-label={`编辑 ${s.name}`}
                    onClick={() => { setEditTarget(s); setModalOpen(true); }}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
                    aria-label={`删除 ${s.name}`}
                    onClick={() => remove(s.name)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {modalOpen && (
        <McpLocalModal
          target={editTarget}
          onClose={() => setModalOpen(false)}
          onSave={handleSubmitServer}
        />
      )}
    </div>
  );
}

function McpLocalModal({
  target,
  onClose,
  onSave,
}: {
  target: DesktopMcpServerEntry | null;
  onClose: () => void;
  onSave: (server: DesktopMcpServerEntry) => void;
}) {
  const [name, setName] = useState(target?.name ?? "");
  const [type, setType] = useState<DesktopMcpServerEntry["type"]>(target?.type ?? "stdio");
  const [url, setUrl] = useState(target?.url ?? "");
  const [command, setCommand] = useState(target?.command ?? "");
  const [args, setArgs] = useState((target?.args ?? []).join(" "));
  const [headers, setHeaders] = useState(target?.headers ? JSON.stringify(target.headers) : "");

  const submit = () => {
    if (!name.trim()) { toast.error("名称不能为空"); return; }
    if (type !== "stdio" && !url.trim()) { toast.error("HTTP/SSE 必须提供 url"); return; }
    if (type === "stdio" && !command.trim()) { toast.error("stdio 必须提供 command"); return; }
    let headersObj: Record<string, string> | undefined;
    if (headers.trim()) {
      try {
        headersObj = JSON.parse(headers) as Record<string, string>;
      } catch {
        toast.error("headers 必须是合法 JSON 对象");
        return;
      }
    }
    onSave({
      name: name.trim(),
      type,
      url: url.trim(),
      command: command.trim(),
      args: args.trim() ? args.split(/\s+/).filter(Boolean) : [],
      headers: headersObj,
      enabled: target?.enabled ?? true,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{target ? "编辑本机 MCP" : "添加本机 MCP"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="!block text-xs text-muted-foreground mb-1">名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 my-coffee" />
          </div>
          <div>
            <Label className="!block text-xs text-muted-foreground mb-1">类型</Label>
            <Select value={type} onValueChange={(v) => setType(v as DesktopMcpServerEntry["type"])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">stdio</SelectItem>
                <SelectItem value="http">http</SelectItem>
                <SelectItem value="sse">sse</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type !== "stdio" ? (
            <>
              <div>
                <Label className="!block text-xs text-muted-foreground mb-1">URL</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8000/mcp" />
              </div>
              <div>
                <Label className="!block text-xs text-muted-foreground mb-1">Headers (JSON，可选)</Label>
                <Textarea
                  className="min-h-20"
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  placeholder='{"Authorization": "Bearer xxx"}'
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label className="!block text-xs text-muted-foreground mb-1">Command</Label>
                <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="如 npx" />
              </div>
              <div>
                <Label className="!block text-xs text-muted-foreground mb-1">Args（空格分隔）</Label>
                <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="如 -y @modelcontextprotocol/server-everything" />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
