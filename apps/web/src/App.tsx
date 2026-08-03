// 根组件：登录态判断 + 视图切换
import { useEffect, useState } from "react";
import { isAuthenticated, handleCallback, login, logout, getUserName } from "./auth";
import DialogueView from "./views/DialogueView";
import SkillsView from "./views/SkillsView";
import type { MessageDto } from "@br-agent/shared";

type View = "dialogue" | "skills";

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

  if (authed === null) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        正在加载…
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-semibold text-gray-800">BR-Agent</h1>
          <button
            onClick={() => login()}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            使用企业账号登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-gray-50">
      {/* 侧边栏 */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <h1 className="font-semibold text-gray-800">BR-Agent</h1>
          <p className="text-xs text-gray-400 mt-0.5">{getUserName()}</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          <button
            onClick={() => setView("dialogue")}
            className={`w-full text-left px-3 py-2 rounded-md text-sm ${
              view === "dialogue" ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            对话
          </button>
          <button
            onClick={() => setView("skills")}
            className={`w-full text-left px-3 py-2 rounded-md text-sm ${
              view === "skills" ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            技能
          </button>
        </nav>
        <div className="p-3 border-t border-gray-100">
          <button
            onClick={() => logout()}
            className="w-full text-left px-3 py-2 rounded-md text-sm text-gray-500 hover:bg-gray-100"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* 主内容 */}
      <main className="flex-1 flex flex-col min-w-0">
        {view === "dialogue" ? (
          <DialogueView activeSessionId={activeSessionId} onSelectSession={setActiveSessionId} />
        ) : (
          <SkillsView />
        )}
      </main>
    </div>
  );
}

export type { MessageDto };
