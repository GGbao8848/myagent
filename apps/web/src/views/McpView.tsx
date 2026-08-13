// MCP 服务器页：列表 + 添加（表单/JSON 双入口）+ 连接测试 + 启停 + 删除
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { getIsAdmin } from "../auth";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Plug, Loader2, ChevronsUpDown, RefreshCw, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { McpServerDto, McpTestResultDto, McpToolInfo } from "@br-agent/shared";
import McpLocalSection from "./McpLocalSection";

type FormTab = "form" | "json";

export default function McpView() {
  const [servers, setServers] = useState<McpServerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, McpTestResultDto & { latencyMs?: number }>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testOpen, setTestOpen] = useState<Record<string, boolean>>({});
  const [editTarget, setEditTarget] = useState<McpServerDto | null>(null);
  const isAdmin = getIsAdmin();

  const load = useCallback(() => {
    setLoading(true);
    api
      .listMcpServers()
      .then(setServers)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 数据刷新后自动探测每个服务器的连接状态（静默，不弹 toast）
  useEffect(() => {
    if (servers.length === 0) return;
    servers.forEach((s) => test(s, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers]);

  const toggle = async (s: McpServerDto) => {
    try {
      await api.toggleMcpServer(s.id, !s.enabled);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const del = async (s: McpServerDto) => {
    if (!confirm(`确定删除 MCP 服务器「${s.name}」？`)) return;
    try {
      await api.deleteMcpServer(s.id);
      toast.success("已删除 MCP 服务器");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const test = async (s: McpServerDto, silent = false) => {
    const start = performance.now();
    setTesting((t) => ({ ...t, [s.id]: true }));
    try {
      const r = await api.testMcpServer(s.id);
      const latencyMs = Math.round(performance.now() - start);
      setTestResults((tr) => ({ ...tr, [s.id]: { ...r, latencyMs } }));
      if (!silent) {
        if (!r.ok) toast.error(r.error || "连接测试失败");
        else toast.success(`连接成功，发现 ${r.tools.length} 个工具`);
      }
    } catch (e) {
      const latencyMs = Math.round(performance.now() - start);
      setTestResults((tr) => ({ ...tr, [s.id]: { ok: false, tools: [], error: (e as Error).message, latencyMs } }));
      if (!silent) toast.error((e as Error).message);
    } finally {
      setTesting((t) => ({ ...t, [s.id]: false }));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">MCP 连接</h2>
        <Button onClick={() => { setEditTarget(null); setShowModal(true); }}>
          添加服务器
        </Button>
      </div>

      {/* 桌面客户端环境：本机工具配置区块（纯浏览器不渲染） */}
      {window.desktopAPI && <McpLocalSection />}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : servers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm py-10">
          <Plug className="size-8 text-muted-foreground/50" />
          暂无 MCP 服务器。添加后启用，对话中 agent 即可调用其工具。
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {servers.map((s) => (
            <Card key={s.id} className="gap-3">
              <CardContent className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground">{s.name}</span>
                    <Badge variant="secondary">{s.type}</Badge>
                    <Badge variant={s.owner === "" ? "secondary" : "outline"}>
                      {s.owner === "" ? "公共" : "私有"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                    {s.type === "http" || s.type === "sse" ? s.url : `${s.command} ${s.args.join(" ")}`}
                  </p>
                  {Object.keys(s.headers).length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
                      headers: {Object.keys(s.headers).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={() => toggle(s)}
                    aria-label={`启用 ${s.name}`}
                  />
                </div>
              </CardContent>

              {/* 状态行：连接状态 + 详情悬浮窗 + 更多操作菜单 */}
              <div className="flex items-center gap-2 border-t border-border px-5 pt-3 pb-0 text-xs text-muted-foreground">
                {testing[s.id] || !testResults[s.id] ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    <span>{testing[s.id] ? "正在探测…" : "自动探测中…"}</span>
                  </>
                ) : (
                  <>
                    <span className={`size-2 rounded-full ${testResults[s.id].ok ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="font-mono">
                      {testResults[s.id].ok
                        ? `${testResults[s.id].latencyMs ?? "?"}ms · ${testResults[s.id].tools.length} tools`
                        : "无法连接"}
                    </span>
                    <div className="ml-auto flex items-center gap-0.5">
                      <Popover open={!!testOpen[s.id]} onOpenChange={(o) => setTestOpen((t) => ({ ...t, [s.id]: o }))}>
                        <PopoverTrigger asChild>
                          <button className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground">
                            <ChevronsUpDown className="size-3.5" />
                            {testResults[s.id].ok ? "详情" : "查看报错"}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-96" align="end">
                          {testing[s.id] ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="size-3.5 animate-spin" /> 正在重新探测…
                            </div>
                          ) : testResults[s.id].ok ? (
                            <>
                              <p className="text-xs text-green-600 mb-2">连接成功，发现 {testResults[s.id].tools.length} 个工具：</p>
                              <div className="space-y-2 max-h-64 overflow-y-auto">
                                {testResults[s.id].tools.map((t: McpToolInfo) => (
                                  <div key={t.name} className="text-xs">
                                    <span className="font-mono font-medium text-foreground">{t.name}</span>
                                    {t.description ? <p className="text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p> : null}
                                    {t.schema ? (
                                      <pre className="mt-1 text-[10px] bg-muted rounded p-1.5 overflow-x-auto max-h-32">
                                        {JSON.stringify(t.schema, null, 1)}
                                      </pre>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <p className="text-xs text-destructive break-words">连接失败：{testResults[s.id].error}</p>
                          )}
                          {!testing[s.id] && testResults[s.id] ? (
                            <div className="mt-3 flex justify-end">
                              <Button size="sm" variant="outline" onClick={() => test(s)}>
                                <RefreshCw className="size-3.5 mr-1" /> 重新测试
                              </Button>
                            </div>
                          ) : null}
                        </PopoverContent>
                      </Popover>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
                            aria-label="更多操作"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          {(s.owner !== "" || isAdmin) && (
                            <DropdownMenuItem onClick={() => { setEditTarget(s); setShowModal(true); }}>
                              <Pencil className="size-4" /> 编辑
                            </DropdownMenuItem>
                          )}
                          {s.owner !== "" && (
                            <DropdownMenuItem variant="destructive" onClick={() => del(s)}>
                              <Trash2 className="size-4" /> 删除
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {showModal && <AddServerModal target={editTarget} onClose={() => setShowModal(false)} onSaved={load} />}
    </div>
  );
}

// ── 添加服务器 Modal：表单 tab + JSON tab ──
function AddServerModal({ target, onClose, onSaved }: { target: McpServerDto | null; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<FormTab>("json");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表单态（编辑时预填）
  const [name, setName] = useState(target?.name ?? "");
  const [type, setType] = useState(target ? (target.type === "stdio" ? "stdio" : "streamablehttp") : "streamablehttp");
  const [url, setUrl] = useState(target?.url ?? "");
  const [command, setCommand] = useState(target?.command ?? "");
  const [args, setArgs] = useState((target?.args ?? []).join(" "));
  const [headers, setHeaders] = useState(
    target && Object.keys(target.headers).length ? JSON.stringify(target.headers, null, 2) : ""
  );

  // JSON 态
  const [jsonText, setJsonText] = useState(() => {
    if (!target) {
      return '{\n  "mcpServers": {\n    "my-server": {\n      "type": "streamablehttp",\n      "url": "https://...",\n      "headers": { "Authorization": "Bearer ..." }\n    }\n  }\n}';
    }
    return JSON.stringify(
      { mcpServers: { [target.name]: { type: target.type, url: target.url, command: target.command, args: target.args, headers: target.headers } } },
      null,
      2
    );
  });

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (tab === "json") {
        if (target) await api.updateMcpServer(target.id, { configJson: jsonText });
        else await api.createMcpServer({ configJson: jsonText });
      } else {
        let headersObj: Record<string, string> = {};
        if (headers.trim()) {
          try {
            headersObj = JSON.parse(headers);
          } catch {
            setError("headers 必须是合法 JSON 对象");
            setSaving(false);
            return;
          }
        }
        const body = {
          name,
          type,
          url,
          command,
          args: args.trim() ? args.split(/\s+/).filter(Boolean) : [],
          headers: headersObj,
        };
        if (target) await api.updateMcpServer(target.id, body);
        else await api.createMcpServer(body);
      }
      toast.success(target ? "已更新 MCP 服务器" : "已添加 MCP 服务器");
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{target ? "编辑 MCP 服务器" : "添加 MCP 服务器"}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as FormTab)} className="mb-1">
          <TabsList className="w-fit">
            <TabsTrigger value="json">粘贴 JSON</TabsTrigger>
            <TabsTrigger value="form">表单填写</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "form" ? (
          <div className="space-y-3">
            <div>
              <Label className="!block text-xs text-muted-foreground mb-1">名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 my-coffee" />
            </div>
            <div>
              <Label className="!block text-xs text-muted-foreground mb-1">类型</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="streamablehttp">streamablehttp</SelectItem>
                  <SelectItem value="stdio">stdio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {type === "streamablehttp" ? (
              <>
                <div>
                  <Label className="!block text-xs text-muted-foreground mb-1">URL</Label>
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://.../mcp" />
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
        ) : (
          <div>
            <Label className="!block text-xs text-muted-foreground mb-1">mcpServers JSON</Label>
            <Textarea
              className="font-mono min-h-48"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">支持 {`{"mcpServers": {...}}`} 格式，取第一个服务器。</p>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
