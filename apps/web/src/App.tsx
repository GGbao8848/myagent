// 根组件：登录态判断 + 视图切换
import { useEffect, useState } from "react";
import { MessagesSquare, FolderKanban, Plug, Cpu, LogOut, Bot, type LucideIcon } from "lucide-react";
import { isAuthenticated, handleCallback, login, logout, getUserName, SESSION_EXPIRED_EVENT } from "./auth";
import DialogueView from "./views/DialogueView";
import SkillsView from "./views/SkillsView";
import McpView from "./views/McpView";
import LlmView from "./views/LlmView";
import { Button } from "@/components/ui/button";
import type { MessageDto } from "@br-agent/shared";

type View = "dialogue" | "skills" | "mcp" | "llm";

const navItems: Array<{ key: View; label: string; icon: LucideIcon }> = [
  { key: "dialogue", label: "对话", icon: MessagesSquare },
  { key: "skills", label: "技能", icon: FolderKanban },
  { key: "mcp", label: "连接管理", icon: Plug },
  { key: "llm", label: "模型配置", icon: Cpu },
];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("dialogue");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

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
          <Button onClick={() => login()} size="lg">
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
        <div className="p-3 border-t border-border">
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
    </div>
  );
}

export type { MessageDto };
