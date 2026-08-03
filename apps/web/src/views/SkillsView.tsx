// 技能页：技能列表 + 上传 zip + 启停
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SkillDto } from "@br-agent/shared";

export default function SkillsView() {
  const [skills, setSkills] = useState<SkillDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.listSkills().then(setSkills).catch((e) => setMsg(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onFile = async (file: File) => {
    setUploading(true);
    setMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = bytesToBase64(new Uint8Array(buffer));
      await api.uploadSkill(base64);
      setMsg("技能上传成功");
      load();
    } catch (e) {
      setMsg("上传失败：" + (e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggle = async (s: SkillDto) => {
    await api.toggleSkill(s.id, !s.enabled);
    load();
  };

  const del = async (s: SkillDto) => {
    if (!confirm(`确定删除技能「${s.name}」？`)) return;
    await api.deleteSkill(s.id);
    load();
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">技能</h2>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? "上传中…" : "上传技能 (zip)"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </div>

      {msg && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-md text-sm">
          {msg}
        </div>
      )}

      {skills.length === 0 ? (
        <div className="text-gray-400 text-sm">暂无技能。上传包含 SKILL.md 的 zip 包安装技能。</div>
      ) : (
        <div className="grid gap-3">
          {skills.map((s) => (
            <div
              key={s.id}
              className="bg-white border border-gray-200 rounded-lg p-4 flex items-start justify-between"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">{s.name}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs ${
                      s.owner === "" ? "bg-green-50 text-green-600" : "bg-purple-50 text-purple-600"
                    }`}
                  >
                    {s.owner === "" ? "公共" : "私有"}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{s.description}</p>
                <p className="text-xs text-gray-400 mt-1">ID: {s.id}</p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                <button
                  onClick={() => toggle(s)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    s.enabled ? "bg-green-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                      s.enabled ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
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
          ))}
        </div>
      )}
    </div>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
