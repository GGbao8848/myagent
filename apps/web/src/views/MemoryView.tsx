// 记忆画像页：用户偏好观察列表 + 新增 + 置信度调整 + 启停 + 删除
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain } from "lucide-react";
import { toast } from "sonner";
import type { ProfileObservationDto } from "@br-agent/shared";

export default function MemoryView() {
  const [observations, setObservations] = useState<ProfileObservationDto[]>([]);
  const [newContent, setNewContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listProfileObservations()
      .then(setObservations)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
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
      toast.success("已添加观察");
      load();
    } catch (e) {
      toast.error("添加失败：" + (e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (o: ProfileObservationDto) => {
    try {
      await api.updateProfileObservation(o.id, { enabled: !o.enabled });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const adjustConfidence = async (o: ProfileObservationDto, delta: number) => {
    const c = Math.max(0, Math.min(1, Math.round((o.confidence + delta) * 100) / 100));
    try {
      await api.updateProfileObservation(o.id, { confidence: c });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const del = async (o: ProfileObservationDto) => {
    if (!confirm(`确定删除该观察？\n「${o.content}」`)) return;
    try {
      await api.deleteProfileObservation(o.id);
      toast.success("已删除观察");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">记忆</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        对话中会自动提取你的偏好，也可手动添加。这些观察会注入后续对话，帮助更贴合你的习惯。
      </p>

      {/* 新增观察 */}
      <div className="flex gap-2 mb-4">
        <Input
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="添加偏好，如：我喜欢简洁的回复"
          className="flex-1"
        />
        <Button onClick={add} disabled={adding || !newContent.trim()}>
          {adding ? "添加中…" : "添加"}
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : observations.length === 0 ? (
        <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm py-10">
          <Brain className="size-8 text-muted-foreground/50" />
          暂无观察。发消息后会自动提取你的偏好，或手动添加。
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {observations.map((o) => (
            <Card key={o.id} className={`gap-3 ${o.enabled ? "" : "opacity-60"}`}>
              <CardContent className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{o.content}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant={o.source === "auto" ? "secondary" : "outline"}>
                      {o.source === "auto" ? "自动提取" : "手动"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">置信度 {o.confidence.toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground">出现 {o.seenCount} 次</span>
                    {!o.enabled && <span className="text-xs text-muted-foreground">（已停用）</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Button variant="ghost" size="icon-xs" onClick={() => adjustConfidence(o, -0.1)} aria-label="降低置信度">−</Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => adjustConfidence(o, 0.1)} aria-label="提高置信度">+</Button>
                  <Switch
                    checked={o.enabled}
                    onCheckedChange={() => toggle(o)}
                    aria-label={`启用观察`}
                  />
                  <Button variant="ghost" size="sm" onClick={() => del(o)} className="text-muted-foreground hover:text-destructive">
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
