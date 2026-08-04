// 记忆画像页：用户偏好观察列表 + 新增 + 置信度调整 + 启停 + 删除
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ProfileObservationDto } from "@br-agent/shared";

export default function MemoryView() {
  const [observations, setObservations] = useState<ProfileObservationDto[]>([]);
  const [newContent, setNewContent] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api.listProfileObservations().then(setObservations).catch((e) => setMsg(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    const content = newContent.trim();
    if (!content) return;
    setAdding(true);
    try {
      await api.createProfileObservation(content);
      setNewContent("");
      load();
    } catch (e) {
      setMsg("添加失败：" + (e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (o: ProfileObservationDto) => {
    await api.updateProfileObservation(o.id, { enabled: !o.enabled });
    load();
  };

  const adjustConfidence = async (o: ProfileObservationDto, delta: number) => {
    const c = Math.max(0, Math.min(1, Math.round((o.confidence + delta) * 100) / 100));
    await api.updateProfileObservation(o.id, { confidence: c });
    load();
  };

  const del = async (o: ProfileObservationDto) => {
    if (!confirm(`确定删除该观察？\n「${o.content}」`)) return;
    await api.deleteProfileObservation(o.id);
    load();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">记忆</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        对话中会自动提取你的偏好，也可手动添加。这些观察会注入后续对话，帮助更贴合你的习惯。
      </p>

      {msg && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-md text-sm">
          {msg}
        </div>
      )}

      {/* 新增观察 */}
      <div className="flex gap-2 mb-4">
        <input
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="添加偏好，如：我喜欢简洁的回复"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={add}
          disabled={adding || !newContent.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {adding ? "添加中…" : "添加"}
        </button>
      </div>

      {observations.length === 0 ? (
        <div className="text-gray-400 text-sm">
          暂无观察。发消息后会自动提取你的偏好，或手动添加。
        </div>
      ) : (
        <div className="grid gap-3">
          {observations.map((o) => (
            <div key={o.id} className={`bg-white border rounded-lg p-4 ${o.enabled ? "border-gray-200" : "border-gray-200 opacity-60"}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">{o.content}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      o.source === "auto" ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"
                    }`}>
                      {o.source === "auto" ? "自动提取" : "手动"}
                    </span>
                    <span className="text-xs text-gray-400">置信度 {o.confidence.toFixed(2)}</span>
                    <span className="text-xs text-gray-400">出现 {o.seenCount} 次</span>
                    {!o.enabled && <span className="text-xs text-gray-400">（已停用）</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => adjustConfidence(o, -0.1)}
                    className="w-6 h-6 rounded bg-gray-100 text-gray-600 text-sm hover:bg-gray-200"
                  >
                    −
                  </button>
                  <button
                    onClick={() => adjustConfidence(o, 0.1)}
                    className="w-6 h-6 rounded bg-gray-100 text-gray-600 text-sm hover:bg-gray-200"
                  >
                    +
                  </button>
                  <button
                    onClick={() => toggle(o)}
                    className={`relative w-9 h-5 rounded-full transition-colors ${
                      o.enabled ? "bg-green-500" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        o.enabled ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                  <button
                    onClick={() => del(o)}
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
