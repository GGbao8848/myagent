// 模型配置页：LLM provider 列表 + 添加/编辑 Modal + 设为默认 + 连接测试 + 删除
// 公共 provider 仅管理员可增删改；私有 provider 本人可见，含个人 apiKey
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { getIsAdmin } from "../auth";
import type { LlmProviderDto } from "@br-agent/shared";

export default function LlmView() {
  const [providers, setProviders] = useState<LlmProviderDto[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [globalDefaultId, setGlobalDefaultId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<LlmProviderDto | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const isAdmin = getIsAdmin();

  const load = useCallback(() => {
    api.listLlmProviders().then((d) => {
      setProviders(d.providers);
      setActiveProviderId(d.activeProviderId);
      setGlobalDefaultId(d.globalDefaultId);
    }).catch((e) => setMsg(e.message));
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
      load();
    } catch (e) {
      setMsg("设为默认失败：" + (e as Error).message);
    }
  };

  const resetDefault = async () => {
    try {
      await api.resetLlmDefault();
      load();
    } catch (e) {
      setMsg("恢复默认失败：" + (e as Error).message);
    }
  };

  const setGlobal = async (p: LlmProviderDto) => {
    try {
      await api.setGlobalDefault(p.id);
      load();
    } catch (e) {
      setMsg("设置全局默认失败：" + (e as Error).message);
    }
  };

  const del = async (p: LlmProviderDto) => {
    if (!confirm(`确定删除模型「${p.name}」？`)) return;
    try {
      await api.deleteLlmProvider(p.id);
      load();
    } catch (e) {
      setMsg("删除失败：" + (e as Error).message);
    }
  };

  const test = async (p: LlmProviderDto) => {
    setTesting((t) => ({ ...t, [p.id]: true }));
    try {
      const r = await api.testLlmProvider(p.id);
      setTestResults((tr) => ({ ...tr, [p.id]: r }));
    } catch (e) {
      setTestResults((tr) => ({ ...tr, [p.id]: { ok: false, error: (e as Error).message } }));
    } finally {
      setTesting((t) => ({ ...t, [p.id]: false }));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-gray-800">模型配置</h2>
        <button
          onClick={() => {
            setEditTarget(null);
            setShowModal(true);
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
        >
          添加模型
        </button>
      </div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          当前默认：<span className="font-medium text-gray-700">{defaultName}</span>
          {!active && <span className="text-gray-400">（未配置时无法使用对话，请联系管理员配置公共模型）</span>}
        </p>
        {activeProviderId && (
          <button
            onClick={resetDefault}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-100"
          >
            清除我的默认
          </button>
        )}
      </div>

      {msg && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-md text-sm">
          {msg}
        </div>
      )}

      {providers.length === 0 ? (
        <div className="text-gray-400 text-sm">
          暂无模型配置。添加后设为默认，对话将使用该模型。
        </div>
      ) : (
        <div className="grid gap-3">
          {providers.map((p) => {
            const isActive = p.id === activeProviderId;
            const isGlobalDefault = p.id === globalDefaultId;
            return (
            <div key={p.id} className={`bg-white border rounded-lg p-4 ${isActive ? "border-blue-400 ring-1 ring-blue-200" : "border-gray-200"}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800">{p.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600 font-mono">
                      {p.model}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs ${
                        p.owner === "" ? "bg-green-50 text-green-600" : "bg-purple-50 text-purple-600"
                      }`}
                    >
                      {p.owner === "" ? "公共" : "私有"}
                    </span>
                    {isActive ? (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600">✓ 我的默认</span>
                    ) : isGlobalDefault ? (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-green-50 text-green-700">★ 公共默认</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-gray-400 mt-1 font-mono truncate">{p.baseUrl}</p>
                  {p.apiKeyMasked ? (
                    <p className="text-xs text-gray-400 mt-0.5 font-mono">apiKey: {p.apiKeyMasked}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 ml-4">
                  {!isActive ? (
                    <button
                      onClick={() => activate(p)}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      设为默认
                    </button>
                  ) : null}
                  {p.owner === "" && isAdmin && !isGlobalDefault ? (
                    <button
                      onClick={() => setGlobal(p)}
                      className="text-xs text-green-600 hover:text-green-800"
                    >
                      设为公共默认
                    </button>
                  ) : null}
                  <button
                    onClick={() => test(p)}
                    disabled={testing[p.id]}
                    className="text-xs text-gray-500 hover:text-blue-600 disabled:opacity-50"
                  >
                    {testing[p.id] ? "测试中…" : "连接测试"}
                  </button>
                  {(p.owner !== "" || isAdmin) && (
                    <button
                      onClick={() => {
                        setEditTarget(p);
                        setShowModal(true);
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      编辑
                    </button>
                  )}
                  {(p.owner !== "" || isAdmin) && (
                    <button
                      onClick={() => del(p)}
                      className="text-xs text-gray-400 hover:text-red-500"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>

              {testResults[p.id] && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  {testResults[p.id].ok ? (
                    <p className="text-xs text-green-600">连接成功，模型可达</p>
                  ) : (
                    <p className="text-xs text-red-500">连接失败：{testResults[p.id].error}</p>
                  )}
                </div>
              )}
            </div>
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
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">{target ? "编辑模型" : "添加模型"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">名称</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="如 DeepSeek-V3" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">模型名</label>
            <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 deepseek-chat" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Base URL（OpenAI 兼容）</label>
            <input className={inputCls} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">API Key {target ? "（留空不修改）" : ""}</label>
            <input
              className={inputCls}
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

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm text-gray-600 hover:bg-gray-100">取消</button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
