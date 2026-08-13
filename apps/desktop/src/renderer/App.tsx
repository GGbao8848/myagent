// 根组件：登录门 + 侧边栏导航（对话/技能/MCP/模型配置，与 web 端一致）
// 服务器地址在打包时硬编码（DEFAULT_SERVER_URL），客户端零配置，无「连接设置」入口
import { useCallback, useEffect, useState } from "react";
import { Bot, Cpu, FolderKanban, LogOut, MessagesSquare, Plug, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolConfirmDialog } from "./components/ToolConfirmDialog";
import DialogueView from "./views/DialogueView";
import SkillsView from "./views/SkillsView";
import McpView from "./views/McpView";
import LlmView from "./views/LlmView";
import { refreshAuthInfo } from "./auth";

type View = "dialogue" | "skills" | "mcp" | "llm";

const navItems: Array<{ key: View; label: string; icon: LucideIcon }> = [
  { key: "dialogue", label: "对话", icon: MessagesSquare },
  { key: "skills", label: "技能", icon: FolderKanban },
  { key: "mcp", label: "连接管理", icon: Plug },
  { key: "llm", label: "模型配置", icon: Cpu },
];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [view, setView] = useState<View>("dialogue");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      const st = await api.authStatus();
      setAuthed(st.ok);
      setUsername(st.username);
      await refreshAuthInfo();
    } catch {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
    const off = window.electronAPI?.onTokenExpired(() => setAuthed(false));
    return () => {
      off?.();
    };
  }, [checkAuth]);

  const login = async () => {
    setLoggingIn(true);
    try {
      const r = await window.electronAPI!.login();
      if (r.ok) {
        await checkAuth();
      } else {
        alert(r.error || "登录失败");
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    await window.electronAPI!.logout();
    setAuthed(false);
  };

  if (authed === null) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">正在加载…</div>;
  }

  if (!authed) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/50">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2">
            <Bot className="size-8 text-primary" />
            <h1 className="text-xl font-semibold text-foreground">BR-Agent</h1>
          </div>
          <Button size="lg" onClick={login} disabled={loggingIn}>
            {loggingIn ? "登录中…" : "使用企业账号登录"}
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
          <p className="text-xs text-muted-foreground mt-0.5">{username}</p>
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
            onClick={logout}
            className="w-full justify-start gap-2 text-muted-foreground"
          >
            <LogOut className="size-4" />
            退出登录
          </Button>
        </div>
      </aside>

      {/* 主内容：所有视图保持挂载（切换仅隐藏），避免对话流式状态丢失 */}
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

      <ToolConfirmDialog />
    </div>
  );
}
