// 技能页：技能列表 + 上传 zip（管理员可选公共/私有 + 拖拽）+ 启停
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { getIsAdmin } from "../auth";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { SkillDto } from "@br-agent/shared";

export default function SkillsView() {
  const [skills, setSkills] = useState<SkillDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isAdmin = getIsAdmin();

  const load = useCallback(() => {
    api.listSkills().then(setSkills).catch((e) => setMsg(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onFile = async (file: File) => {
    if (!file.name.endsWith(".zip") && !file.type.includes("zip")) {
      setMsg("请上传 zip 文件");
      return;
    }
    setUploading(true);
    setMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = bytesToBase64(new Uint8Array(buffer));
      await api.uploadSkill(base64, isPublic);
      setMsg(isPublic ? "公共技能上传成功" : "技能上传成功");
      load();
    } catch (e) {
      setMsg("上传失败：" + (e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // 拖拽上传
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
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
        <div className="flex items-center gap-2">
          {isAdmin && (
            <select
              value={isPublic ? "public" : "private"}
              onChange={(e) => setIsPublic(e.target.value === "public")}
              className="px-2 py-1.5 border border-gray-300 rounded-md text-sm"
            >
              <option value="private">私有（仅自己可见）</option>
              <option value="public">公共（所有用户可见）</option>
            </select>
          )}
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
      </div>

      {/* 拖拽上传区 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`mb-4 border-2 border-dashed rounded-lg p-6 text-center text-sm cursor-pointer transition-colors ${
          dragOver ? "border-blue-500 bg-blue-50 text-blue-600" : "border-gray-300 text-gray-400 hover:border-gray-400"
        }`}
      >
        将 zip 文件拖到此处，或点击选择上传（{isAdmin ? `将作为${isPublic ? "公共" : "私有"}技能` : "私有技能"}）
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
                  <Badge variant={s.owner === "" ? "secondary" : "outline"} className={s.owner === "" ? "bg-green-50 text-green-700" : "bg-purple-50 text-purple-700"}>
                    {s.owner === "" ? "公共" : "私有"}
                  </Badge>
                </div>
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{s.description}</p>
                <p className="text-xs text-gray-400 mt-1">ID: {s.id}</p>
              </div>
              <div className="flex items-center gap-3 ml-4">
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
