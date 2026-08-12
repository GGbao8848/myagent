// 技能页：技能列表 + 上传 zip（管理员可选公共/私有 + 拖拽）+ 启停
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { getIsAdmin } from "../auth";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderKanban } from "lucide-react";
import { toast } from "sonner";
import type { SkillDto } from "@br-agent/shared";

export default function SkillsView() {
  const [skills, setSkills] = useState<SkillDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const isAdmin = getIsAdmin();

  const load = useCallback(() => {
    setLoading(true);
    api.listSkills().then(setSkills).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onFile = async (file: File) => {
    if (!file.name.endsWith(".zip") && !file.type.includes("zip")) {
      toast.error("请上传 zip 文件");
      return;
    }
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = bytesToBase64(new Uint8Array(buffer));
      await api.uploadSkill(base64, isPublic);
      toast.success(isPublic ? "公共技能上传成功" : "技能上传成功");
      load();
    } catch (e) {
      toast.error("上传失败：" + (e as Error).message);
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
    try {
      await api.toggleSkill(s.id, !s.enabled);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const del = async (s: SkillDto) => {
    if (!confirm(`确定删除技能「${s.name}」？`)) return;
    try {
      await api.deleteSkill(s.id);
      toast.success("已删除技能");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">技能</h2>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Select value={isPublic ? "public" : "private"} onValueChange={(v) => setIsPublic(v === "public")}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">私有（仅自己可见）</SelectItem>
                <SelectItem value="public">公共（所有用户可见）</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "上传中…" : "上传技能 (zip)"}
          </Button>
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
          dragOver ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-border"
        }`}
      >
        将 zip 文件拖到此处，或点击选择上传（{isAdmin ? `将作为${isPublic ? "公共" : "私有"}技能` : "私有技能"}）
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : skills.length === 0 ? (
        <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm py-10">
          <FolderKanban className="size-8 text-muted-foreground/50" />
          暂无技能。上传包含 SKILL.md 的 zip 包安装技能。
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {skills.map((s) => (
            <Card key={s.id} className="gap-3 flex-row items-center justify-between">
              <div className="flex-1 min-w-0 px-5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{s.name}</span>
                  <Badge variant={s.owner === "" ? "secondary" : "outline"}>
                    {s.owner === "" ? "公共" : "私有"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{s.description}</p>
                <p className="text-xs text-muted-foreground mt-1">ID: {s.id}</p>
              </div>
              <div className="flex items-center gap-3 ml-4 px-5">
                <Switch
                  checked={s.enabled}
                  onCheckedChange={() => toggle(s)}
                  aria-label={`启用 ${s.name}`}
                />
                {s.owner !== "" && (
                  <Button variant="ghost" size="sm" onClick={() => del(s)} className="text-muted-foreground hover:text-destructive">
                    删除
                  </Button>
                )}
              </div>
            </Card>
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
