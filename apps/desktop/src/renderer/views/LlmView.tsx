// 模型配置页：LLM provider 列表 + 添加/编辑 Modal + 设为默认 + 连接测试 + 删除
// 公共 provider 仅管理员可增删改；私有 provider 本人可见，含个人 apiKey
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { getIsAdmin } from "../auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Cpu, ChevronsUpDown, Loader2, RefreshCw, CheckCircle2, Globe, Pencil, Trash2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { LlmProviderDto } from "@br-agent/shared";

export default function LlmView() {
  const [providers, setProviders] = useState<LlmProviderDto[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [globalDefaultId, setGlobalDefaultId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<LlmProviderDto | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string; latencyMs?: number }>>({});
  const [testOpen, setTestOpen] = useState<Record<string, boolean>>({});
  const isAdmin = getIsAdmin();

  const load = useCallback(() => {
    setLoading(true);
    api.listLlmProviders().then((d) => {
      setProviders(d.providers);
      setActiveProviderId(d.activeProviderId);
      setGlobalDefaultId(d.globalDefaultId);
    }).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 数据刷新后自动探测每个 provider 的连接状态（静默，不弹 toast）
  useEffect(() => {
    if (providers.length === 0) return;
    providers.forEach((p) => test(p, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  // 实际生效的默认：用户私有默认 → 公共全局默认 → 未配置
  const active = providers.find((p) => p.id === activeProviderId)
    ?? providers.find((p) => p.id === globalDefaultId);
  const defaultName = active ? `${active.name} (${active.model})` : "未配置";

  const activate = async (p: LlmProviderDto) => {
    try {
      await api.activateLlmProvider(p.id);
      toast.success("已设为我的默认");
      load();
    } catch (e) {
      toast.error("设为默认失败：" + (e as Error).message);
    }
  };

  const resetDefault = async () => {
    try {
      await api.resetLlmDefault();
      toast.success("已清除我的默认");
      load();
    } catch (e) {
      toast.error("恢复默认失败：" + (e as Error).message);
    }
  };

  const setGlobal = async (p: LlmProviderDto) => {
    try {
      await api.setGlobalDefault(p.id);
      toast.success("已设为公共默认");
      load();
    } catch (e) {
      toast.error("设置全局默认失败：" + (e as Error).message);
    }
  };

  const del = async (p: LlmProviderDto) => {
    if (!confirm(`确定删除模型「${p.name}」？`)) return;
    try {
      await api.deleteLlmProvider(p.id);
      toast.success("已删除模型");
      load();
    } catch (e) {
      toast.error("删除失败：" + (e as Error).message);
    }
  };

  const test = async (p: LlmProviderDto, silent = false) => {
    const start = performance.now();
    setTesting((t) => ({ ...t, [p.id]: true }));
    try {
      const r = await api.testLlmProvider(p.id);
      const latencyMs = Math.round(performance.now() - start);
      setTestResults((tr) => ({ ...tr, [p.id]: { ...r, latencyMs } }));
    } catch (e) {
      const latencyMs = Math.round(performance.now() - start);
      setTestResults((tr) => ({ ...tr, [p.id]: { ok: false, error: (e as Error).message, latencyMs } }));
      if (!silent) toast.error("连接测试失败：" + (e as Error).message);
    } finally {
      setTesting((t) => ({ ...t, [p.id]: false }));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-foreground">模型配置</h2>
        <Button
          onClick={() => {
            setEditTarget(null);
            setShowModal(true);
          }}
        >
          添加模型
        </Button>
      </div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          当前默认：<span className="font-medium text-foreground">{defaultName}</span>
          {!active && <span className="text-muted-foreground">（未配置时无法使用对话，请联系管理员配置公共模型）</span>}
        </p>
        {activeProviderId && (
          <Button variant="outline" size="sm" onClick={resetDefault}>
            清除我的默认
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : providers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm py-10">
          <Cpu className="size-8 text-muted-foreground/50" />
          暂无模型配置。添加后设为默认，对话将使用该模型。
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((p) => {
            const isActive = p.id === activeProviderId;
            const isGlobalDefault = p.id === globalDefaultId;
            return (
            <Card key={p.id} className={`gap-3 ${isActive ? "border-primary/60 ring-1 ring-primary/20" : ""}`}>
              <CardContent className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground">{p.name}</span>
                    <Badge variant="secondary" className="font-mono">{p.model}</Badge>
                    <Badge variant={p.owner === "" ? "secondary" : "outline"}>
                      {p.owner === "" ? "公共" : "私有"}
                    </Badge>
                    {isActive ? (
                      <Badge variant="default">✓ 我的默认</Badge>
                    ) : isGlobalDefault ? (
                      <Badge variant="secondary">★ 公共默认</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{p.baseUrl}</p>
                  {p.apiKeyMasked ? (
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">apiKey: {p.apiKeyMasked}</p>
                  ) : null}
                </div>
              </CardContent>

              {/* 状态行：连接状态 + 详情悬浮窗 + 更多操作菜单 */}
              <div className="flex items-center gap-2 border-t border-border px-5 pt-3 pb-0 text-xs text-muted-foreground">
                {testing[p.id] || !testResults[p.id] ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    <span>{testing[p.id] ? "正在探测…" : "自动探测中…"}</span>
                  </>
                ) : (
                  <>
                    <span className={`size-2 rounded-full ${testResults[p.id].ok ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="font-mono">{testResults[p.id].ok ? `${testResults[p.id].latencyMs ?? "?"}ms` : "无法连接"}</span>
                    <div className="ml-auto flex items-center gap-0.5">
                      <Popover open={!!testOpen[p.id]} onOpenChange={(o) => setTestOpen((t) => ({ ...t, [p.id]: o }))}>
                        <PopoverTrigger asChild>
                          <button className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground">
                            <ChevronsUpDown className="size-3.5" />
                            {testResults[p.id].ok ? "详情" : "查看报错"}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80" align="end">
                          {testing[p.id] ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="size-3.5 animate-spin" /> 正在重新探测…
                            </div>
                          ) : testResults[p.id].ok ? (
                            <>
                              <p className="text-xs text-green-600">连接成功，模型可达</p>
                              <p className="text-xs text-muted-foreground mt-1">延迟 {testResults[p.id].latencyMs}ms</p>
                            </>
                          ) : (
                            <p className="text-xs text-destructive break-words">连接失败：{testResults[p.id].error}</p>
                          )}
                          {!testing[p.id] && testResults[p.id] ? (
                            <div className="mt-3 flex justify-end">
                              <Button size="sm" variant="outline" onClick={() => test(p)}>
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
                        <DropdownMenuContent align="end" className="w-40">
                          {!isActive && (
                            <DropdownMenuItem onClick={() => activate(p)}>
                              <CheckCircle2 className="size-4" /> 设为默认
                            </DropdownMenuItem>
                          )}
                          {p.owner === "" && isAdmin && !isGlobalDefault ? (
                            <DropdownMenuItem onClick={() => setGlobal(p)}>
                              <Globe className="size-4" /> 设为公共默认
                            </DropdownMenuItem>
                          ) : null}
                          {(p.owner !== "" || isAdmin) && (
                            <DropdownMenuItem onClick={() => { setEditTarget(p); setShowModal(true); }}>
                              <Pencil className="size-4" /> 编辑
                            </DropdownMenuItem>
                          )}
                          {(p.owner !== "" || isAdmin) && (
                            <DropdownMenuItem variant="destructive" onClick={() => del(p)}>
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
            );
          })}
        </div>
      )}

      {showModal && (
        <ProviderModal
          isAdmin={isAdmin}
          target={editTarget}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            load();
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}

// ── 添加/编辑 Modal ──
function ProviderModal({
  isAdmin,
  target,
  onClose,
  onSaved,
}: {
  isAdmin: boolean;
  target: LlmProviderDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(target?.name ?? "");
  const [model, setModel] = useState(target?.model ?? "");
  const [baseUrl, setBaseUrl] = useState(target?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [isPublic, setIsPublic] = useState(target ? target.owner === "" : false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (target) {
        await api.updateLlmProvider(target.id, {
          name,
          model,
          baseUrl,
          apiKey: apiKey.trim() || undefined, // 留空不修改
        });
      } else {
        await api.createLlmProvider({
          name,
          model,
          baseUrl,
          apiKey: apiKey.trim() || undefined,
          public: isPublic,
        });
      }
      toast.success(target ? "已更新模型" : "已添加模型");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{target ? "编辑模型" : "添加模型"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="!block text-xs text-muted-foreground mb-1">名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 DeepSeek-V3" />
          </div>
          <div>
            <Label className="!block text-xs text-muted-foreground mb-1">模型名</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 deepseek-chat" />
          </div>
          <div>
            <Label className="!block text-xs text-muted-foreground mb-1">Base URL（OpenAI 兼容）</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
          </div>
          <div>
            <Label className="!block text-xs text-muted-foreground mb-1">API Key {target ? "（留空不修改）" : ""}</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={target?.apiKeyMasked ? `已配置 ${target.apiKeyMasked}` : "sk-..."}
            />
          </div>
          {!target && isAdmin && (
            <div>
              <Label className="!block text-xs text-muted-foreground mb-1">可见范围</Label>
              <Select value={isPublic ? "public" : "private"} onValueChange={(v) => setIsPublic(v === "public")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">私有（仅自己可见）</SelectItem>
                  <SelectItem value="public">公共（所有用户可见，仅管理员可改）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {!target && !isAdmin && (
            <p className="text-xs text-muted-foreground">新添加的模型为私有，仅自己可见。</p>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
