// 模型配置页：LLM provider 列表 + 添加/编辑 Modal + 设为默认 + 连接测试 + 删除
// 公共 provider 仅管理员可增删改；私有 provider 本人可见，含个人 apiKey
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { getIsAdmin } from "../auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Cpu } from "lucide-react";
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
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string }>>({});
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

  const test = async (p: LlmProviderDto) => {
    setTesting((t) => ({ ...t, [p.id]: true }));
    try {
      const r = await api.testLlmProvider(p.id);
      setTestResults((tr) => ({ ...tr, [p.id]: r }));
    } catch (e) {
      setTestResults((tr) => ({ ...tr, [p.id]: { ok: false, error: (e as Error).message } }));
      toast.error("连接测试失败：" + (e as Error).message);
    } finally {
      setTesting((t) => ({ ...t, [p.id]: false }));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-gray-800">模型配置</h2>
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
        <p className="text-sm text-gray-500">
          当前默认：<span className="font-medium text-gray-700">{defaultName}</span>
          {!active && <span className="text-gray-400">（未配置时无法使用对话，请联系管理员配置公共模型）</span>}
        </p>
        {activeProviderId && (
          <Button variant="outline" size="sm" onClick={resetDefault}>
            清除我的默认
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : providers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm py-10">
          <Cpu className="size-8 text-muted-foreground/50" />
          暂无模型配置。添加后设为默认，对话将使用该模型。
        </div>
      ) : (
        <div className="grid gap-3">
          {providers.map((p) => {
            const isActive = p.id === activeProviderId;
            const isGlobalDefault = p.id === globalDefaultId;
            return (
            <Card key={p.id} className={`gap-3 ${isActive ? "border-primary/60 ring-1 ring-primary/20" : ""}`}>
              <CardContent className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800">{p.name}</span>
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
                <div className="flex items-center gap-1 ml-4 flex-wrap justify-end">
                  {!isActive ? (
                    <Button variant="ghost" size="sm" onClick={() => activate(p)} className="text-primary hover:text-primary/80">
                      设为默认
                    </Button>
                  ) : null}
                  {p.owner === "" && isAdmin && !isGlobalDefault ? (
                    <Button variant="ghost" size="sm" onClick={() => setGlobal(p)} className="text-green-600 hover:text-green-700">
                      设为公共默认
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => test(p)} disabled={testing[p.id]} className="text-muted-foreground hover:text-primary">
                    {testing[p.id] ? "测试中…" : "连接测试"}
                  </Button>
                  {(p.owner !== "" || isAdmin) && (
                    <Button variant="ghost" size="sm" onClick={() => { setEditTarget(p); setShowModal(true); }} className="text-muted-foreground hover:text-foreground">
                      编辑
                    </Button>
                  )}
                  {(p.owner !== "" || isAdmin) && (
                    <Button variant="ghost" size="sm" onClick={() => del(p)} className="text-muted-foreground hover:text-red-500">
                      删除
                    </Button>
                  )}
                </div>
              </CardContent>

              {testResults[p.id] && (
                <CardContent className="border-t border-border pt-3">
                  {testResults[p.id].ok ? (
                    <p className="text-xs text-green-600">连接成功，模型可达</p>
                  ) : (
                    <p className="text-xs text-red-500">连接失败：{testResults[p.id].error}</p>
                  )}
                </CardContent>
              )}
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

  const inputCls =
    "w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{target ? "编辑模型" : "添加模型"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 DeepSeek-V3" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">模型名</label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 deepseek-chat" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Base URL（OpenAI 兼容）</label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">API Key {target ? "（留空不修改）" : ""}</label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={target?.apiKeyMasked ? `已配置 ${target.apiKeyMasked}` : "sk-..."}
            />
          </div>
          {!target && isAdmin && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">可见范围</label>
              <select className={inputCls} value={isPublic ? "public" : "private"} onChange={(e) => setIsPublic(e.target.value === "public")}>
                <option value="private">私有（仅自己可见）</option>
                <option value="public">公共（所有用户可见，仅管理员可改）</option>
              </select>
            </div>
          )}
          {!target && !isAdmin && (
            <p className="text-xs text-gray-400">新添加的模型为私有，仅自己可见。</p>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

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
