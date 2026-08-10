// MCP 服务器页：列表 + 添加（表单/JSON 双入口）+ 连接测试 + 启停 + 删除
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { McpServerDto, McpTestResultDto, McpToolInfo } from "@br-agent/shared";

type FormTab = "form" | "json";

export default function McpView() {
  const [servers, setServers] = useState<McpServerDto[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, McpTestResultDto>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    api.listMcpServers().then(setServers).catch((e) => setMsg(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (s: McpServerDto) => {
    await api.toggleMcpServer(s.id, !s.enabled);
    load();
  };

  const del = async (s: McpServerDto) => {
    if (!confirm(`确定删除 MCP 服务器「${s.name}」？`)) return;
    await api.deleteMcpServer(s.id);
    load();
  };

  const test = async (s: McpServerDto) => {
    setTesting((t) => ({ ...t, [s.id]: true }));
    try {
      const r = await api.testMcpServer(s.id);
      setTestResults((tr) => ({ ...tr, [s.id]: r }));
    } catch (e) {
      setTestResults((tr) => ({ ...tr, [s.id]: { ok: false, tools: [], error: (e as Error).message } }));
    } finally {
      setTesting((t) => ({ ...t, [s.id]: false }));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">MCP 连接</h2>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
        >
          添加服务器
        </button>
      </div>

      {msg && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-md text-sm">
          {msg}
        </div>
      )}

      {servers.length === 0 ? (
        <div className="text-gray-400 text-sm">
          暂无 MCP 服务器。添加后启用，对话中 agent 即可调用其工具。
        </div>
      ) : (
        <div className="grid gap-3">
          {servers.map((s) => (
            <div key={s.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800">{s.name}</span>
                    <Badge variant="secondary">{s.type}</Badge>
                    <Badge variant={s.owner === "" ? "secondary" : "outline"} className={s.owner === "" ? "bg-green-50 text-green-700" : "bg-purple-50 text-purple-700"}>
                      {s.owner === "" ? "公共" : "私有"}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-400 mt-1 font-mono truncate">
                    {s.type === "http" || s.type === "sse" ? s.url : `${s.command} ${s.args.join(" ")}`}
                  </p>
                  {Object.keys(s.headers).length > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">
                      headers: {Object.keys(s.headers).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <button
                    onClick={() => test(s)}
                    disabled={testing[s.id]}
                    className="text-xs text-gray-500 hover:text-blue-600 disabled:opacity-50"
                  >
                    {testing[s.id] ? "测试中…" : "连接测试"}
                  </button>
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={() => toggle(s)}
                    aria-label={`启用 ${s.name}`}
                  />
                  {s.owner !== "" && (
                    <button
                      onClick={() => del(s)}
                      className="text-xs text-gray-400 hover:text-red-500"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>

              {testResults[s.id] && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  {testResults[s.id].ok ? (
                    <>
                      <p className="text-xs text-green-600 mb-1">连接成功，发现 {testResults[s.id].tools.length} 个工具：</p>
                      <div className="grid gap-1">
                        {testResults[s.id].tools.map((t: McpToolInfo) => (
                          <div key={t.name} className="text-xs">
                            <span className="font-mono text-gray-700">{t.name}</span>
                            <span className="text-gray-400 ml-2">{t.description}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-red-500">连接失败：{testResults[s.id].error}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && <AddServerModal onClose={() => setShowModal(false)} onSaved={load} />}
    </div>
  );
}

// ── 添加服务器 Modal：表单 tab + JSON tab ──
function AddServerModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<FormTab>("form");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表单态
  const [name, setName] = useState("");
  const [type, setType] = useState("streamablehttp");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [headers, setHeaders] = useState("");

  // JSON 态
  const [jsonText, setJsonText] = useState(
    '{\n  "mcpServers": {\n    "my-server": {\n      "type": "streamablehttp",\n      "url": "https://...",\n      "headers": { "Authorization": "Bearer ..." }\n    }\n  }\n}'
  );

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (tab === "json") {
        await api.createMcpServer({ configJson: jsonText });
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
        await api.createMcpServer({
          name,
          type,
          url,
          command,
          args: args.trim() ? args.split(/\s+/).filter(Boolean) : [],
          headers: headersObj,
        });
      }
      onSaved();
      onClose();
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>添加 MCP 服务器</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as FormTab)} className="mb-1">
          <TabsList className="w-fit">
            <TabsTrigger value="form">表单填写</TabsTrigger>
            <TabsTrigger value="json">粘贴 JSON</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "form" ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">名称</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="如 my-coffee" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">类型</label>
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="streamablehttp">streamablehttp</option>
                <option value="stdio">stdio</option>
              </select>
            </div>
            {type === "streamablehttp" ? (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">URL</label>
                  <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://.../mcp" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Headers (JSON，可选)</label>
                  <textarea
                    className={inputCls}
                    rows={3}
                    value={headers}
                    onChange={(e) => setHeaders(e.target.value)}
                    placeholder='{"Authorization": "Bearer xxx"}'
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Command</label>
                  <input className={inputCls} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="如 npx" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Args（空格分隔）</label>
                  <input className={inputCls} value={args} onChange={(e) => setArgs(e.target.value)} placeholder="如 -y @modelcontextprotocol/server-everything" />
                </div>
              </>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-xs text-gray-500 mb-1">mcpServers JSON</label>
            <textarea
              className={inputCls}
              rows={10}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">支持 {`{"mcpServers": {...}}`} 格式，取第一个服务器。</p>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

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
