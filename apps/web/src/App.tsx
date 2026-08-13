// 根组件：登录态判断 + 视图切换
import { useEffect, useState } from "react";
import { MessagesSquare, FolderKanban, Plug, Cpu, LogOut, Bot, Settings, type LucideIcon } from "lucide-react";
import { isAuthenticated, handleCallback, login, logout, getUserName, SESSION_EXPIRED_EVENT, TOKEN_KEY, getTokens, clearTokens } from "./auth";
import DialogueView from "./views/DialogueView";
import SkillsView from "./views/SkillsView";
import McpView from "./views/McpView";
import LlmView from "./views/LlmView";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { MessageDto } from "@br-agent/shared";

type View = "dialogue" | "skills" | "mcp" | "llm";

const navItems: Array<{ key: View; label: string; icon: LucideIcon }> = [
  { key: "dialogue", label: "对话", icon: MessagesSquare },
  { key: "skills", label: "技能", icon: FolderKanban },
  { key: "mcp", label: "连接管理", icon: Plug },
  { key: "llm", label: "模型配置", icon: Cpu },
];

// 单点登录（SSO）自动跳转标记：首次打开未登录时自动跳 Keycloak（SSO 会话在则免密回跳），
// 用 sessionStorage 防循环——用户取消/失败后停留登录页；点登录按钮时清除以便再次自动跳。
const AUTO_LOGIN_KEY = "kc_auto_login_attempted";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("dialogue");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    // 处理 Keycloak 回调（URL 带 code）。
    // 防重：同一 code 只能兑换一次（Keycloak 会拒绝重复使用），
    // 避免 StrictMode/重放导致二次兑换污染 session。
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      const consumed = sessionStorage.getItem("kc_consumed_code");
      if (consumed === code) {
        window.history.replaceState({}, "", "/");
        setAuthed(isAuthenticated());
        return;
      }
      sessionStorage.setItem("kc_consumed_code", code);
      handleCallback(code)
        .then(() => {
          window.history.replaceState({}, "", "/");
          setAuthed(true);
        })
        .catch(() => {
          sessionStorage.removeItem("kc_consumed_code");
          window.history.replaceState({}, "", "/");
          setAuthed(false);
        });
      return;
    }
    setAuthed(isAuthenticated());
  }, []);

  useEffect(() => {
    // 会话过期（token 刷新失败）：清登录态，切回登录页
    const onSessionExpired = () => setAuthed(false);
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);

  useEffect(() => {
    // 单点登出（SLO）：Keycloak 登出时 front-channel iframe 加载 /slo-logout 清掉本页 localStorage token，
    // 同源 iframe 的 localStorage 变更会触发父页面 storage 事件 → 自动切回登录页
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY && !e.newValue) setAuthed(false);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    // 单点登出（SLO）：br-agent 配置了 back-channel logout 后 Keycloak 跳过 front-channel iframe，
    // 故经服务器 SSE 推送登出——任意端登出 → Keycloak back-channel → server 广播 → 本页退出
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      const { access } = getTokens();
      if (!access || es) return;
      const src = new EventSource(`/api/sse/logout?token=${encodeURIComponent(access)}`);
      es = src;
      src.onmessage = (e) => {
        if (e.data === "logout") {
          clearTokens();
          setAuthed(false);
        }
      };
      src.onerror = () => {
        src.close();
        es = null;
        // token 可能已刷新，延迟重连
        timer = setTimeout(connect, 5000);
      };
    };
    if (authed) connect();
    return () => {
      if (timer) clearTimeout(timer);
      if (es) {
        es.close();
        es = null;
      }
    };
  }, [authed]);

  useEffect(() => {
    // 单点登录（SSO）：未登录且本标签页未尝试过自动登录时，自动跳 Keycloak——
    // 已在其他应用（aimemory 等）登录过则免密回跳进入；从未登录则进入 Keycloak 登录页。
    // sessionStorage 标记防循环：自动跳失败/取消后停留登录页（标记保留），
    // 用户点登录按钮时清除标记（手动路径不再自动跳，避免干扰）。
    if (authed === false && !sessionStorage.getItem(AUTO_LOGIN_KEY)) {
      sessionStorage.setItem(AUTO_LOGIN_KEY, "1");
      void login();
    }
  }, [authed]);

  if (authed === null) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        正在加载…
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-semibold text-foreground">BR-Agent</h1>
          <Button
            onClick={() => {
              sessionStorage.removeItem(AUTO_LOGIN_KEY);
              void login();
            }}
            size="lg"
          >
            使用企业账号登录
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-muted/50">
      {/* 侧边栏 */}
      <aside className="w-fit bg-white border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Bot className="size-5 text-primary" />
            BR-Agent
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{getUserName()}</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  view === item.key
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border space-y-1">
          {window.desktopAPI && (
            <Button
              variant="ghost"
              onClick={() => setShowSettings(true)}
              className="w-full justify-start gap-2 text-muted-foreground"
            >
              <Settings className="size-4" />
              连接设置
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => logout()}
            className="w-full justify-start gap-2 text-muted-foreground"
          >
            <LogOut className="size-4" />
            退出登录
          </Button>
        </div>
      </aside>

      {/* 主内容：所有视图保持挂载（切换仅隐藏），避免对话流式状态/SSE 连接随卸载丢失 */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className={view === "dialogue" ? "flex-1 flex flex-col min-w-0 min-h-0" : "hidden"}>
          <DialogueView activeSessionId={activeSessionId} onSelectSession={setActiveSessionId} />
        </div>
        <div className={view === "skills" ? "flex-1 flex flex-col min-w-0 min-h-0" : "hidden"}>
          <SkillsView />
        </div>
        <div className={view === "mcp" ? "flex-1 flex flex-col min-w-0 min-h-0" : "hidden"}>
          <McpView />
        </div>
        <div className={view === "llm" ? "flex-1 flex flex-col min-w-0 min-h-0" : "hidden"}>
          <LlmView />
        </div>
      </main>

      {/* 桌面客户端：服务器连接设置（纯浏览器不显示） */}
      {showSettings && window.desktopAPI && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/** 桌面客户端连接设置：修改 BR-Agent 服务器地址（经 desktopAPI 交给主进程保存并重连） */
function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [serverUrl, setServerUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.desktopAPI
      ?.getSettings()
      .then((s) => setServerUrl(s.serverUrl ?? ""))
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await window.desktopAPI!.saveSettings({ serverUrl });
      if (r.ok) {
        toast.success("已保存，正在连接新服务器…");
        onClose();
      } else {
        toast.error(r.error || "保存失败");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>连接设置</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="!block text-xs text-muted-foreground mb-1">服务器地址</Label>
            <Input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.100:9005"
            />
          </div>
          <p className="text-xs text-muted-foreground">修改后客户端将重新连接该服务器的界面与本机能力网关。</p>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存并连接"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { MessageDto };
