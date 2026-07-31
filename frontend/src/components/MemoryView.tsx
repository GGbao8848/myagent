import React from "react";
import { motion } from "motion/react";
import { 
  Brain, Info, AlertTriangle, User, LogOut, LogIn, RefreshCw, X 
} from "lucide-react";
import { MemoryItem, UserProfile } from "../types";

interface MemoryViewProps {
  showTips: boolean;
  toggleShowTips: () => void;
  isMemoryEnabled: boolean;
  setIsMemoryEnabled: (enabled: boolean) => void;
  memories: MemoryItem[];
  userProfile: UserProfile;
  setUserProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  isLoggedIn: boolean;
  handleLogout: () => void;
  setShowLoginModal: (show: boolean) => void;
  newMemoryContent: string;
  setNewMemoryContent: (content: string) => void;
  newMemoryCategory: "preference" | "profile" | "system" | "schedule";
  setNewMemoryCategory: (cat: "preference" | "profile" | "system" | "schedule") => void;
  handleAddMemory: (e: React.FormEvent) => void;
  handleDeleteMemory: (id: string) => void;
}

export const MemoryView: React.FC<MemoryViewProps> = ({
  showTips,
  toggleShowTips,
  isMemoryEnabled,
  setIsMemoryEnabled,
  memories,
  userProfile,
  setUserProfile,
  isLoggedIn,
  handleLogout,
  setShowLoginModal,
  newMemoryContent,
  setNewMemoryContent,
  newMemoryCategory,
  setNewMemoryCategory,
  handleAddMemory,
  handleDeleteMemory,
}) => {
  return (
    <motion.div 
      key="memory-view"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.15 }}
      className="p-6 overflow-y-auto h-full"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Page header banner */}
        <div className="border-b border-slate-100 pb-5">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div>
              <h2 className="text-xl font-display font-semibold text-slate-900 flex items-center gap-2">
                <Brain className="w-5 h-5 text-indigo-500 shrink-0" />
                <span>记忆与认知画像</span>
              </h2>
              {showTips && (
                <p className="text-xs text-slate-500 mt-1 animate-fade-in">
                  查看并管理大模型对您的偏好认知事实（Persona & Memories）。这些设定会被永久编码到 AI 的系统指令里，从而让其提供越用越懂您的极致服务。
                </p>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                onClick={toggleShowTips}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                  showTips 
                    ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100" 
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Info className="w-3.5 h-3.5" />
                <span>{showTips ? "隐藏说明" : "显示说明"}</span>
              </button>

              <div className="flex items-center gap-2.5 bg-white border border-slate-200 px-3.5 py-2 rounded-xl shadow-2xs">
                <div className="text-right">
                  <span className="block text-xs font-semibold text-slate-800">大模型加载记忆</span>
                  <span className={`text-[9px] block ${isMemoryEnabled ? "text-emerald-600 font-semibold" : "text-slate-400"}`}>
                    {isMemoryEnabled ? "已启用加载" : "已暂停加载"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMemoryEnabled(!isMemoryEnabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                    isMemoryEnabled ? "bg-emerald-500" : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      isMemoryEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="bg-white border border-slate-150 p-2.5 rounded-xl flex items-center gap-3 shadow-2xs">
                <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-bold bg-emerald-50/50 transition-colors ${
                  isMemoryEnabled ? "border-emerald-500 text-emerald-600" : "border-slate-300 text-slate-400 bg-slate-50/50"
                }`}>
                  {isMemoryEnabled ? "85%" : "0%"}
                </div>
                <div>
                  <h4 className={`text-xs font-semibold leading-tight transition-colors ${isMemoryEnabled ? "text-slate-800" : "text-slate-400"}`}>认知匹配度</h4>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {isMemoryEnabled ? `已记录 ${memories.length} 条核心偏好事实` : "AI 账本加载已禁用"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {!isMemoryEnabled && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-50/80 border border-amber-200 rounded-xl p-4 flex items-start gap-3 shadow-2xs"
          >
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-semibold text-amber-800">AI 记忆与画像处于关闭状态</h4>
              <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                当前已手动关闭大模型记忆加载。与 AI 会话时，系统<strong>不会</strong>将您的“用户基础画像”以及“事实习惯条目”注入到 AI 的系统指令中，智能体将退回至通用默认状态，从而不加载任何您的专属偏好。
              </p>
            </div>
          </motion.div>
        )}

        <div className={`grid grid-cols-1 lg:grid-cols-12 gap-6 transition-all duration-300 ${!isMemoryEnabled ? "opacity-60 saturate-50" : "opacity-100"}`}>
          
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-2xs self-start">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-50 pb-3">
              <User className="w-4 h-4 text-slate-400" />
              <h3 className="font-display font-semibold text-sm text-slate-800">用户基础画像配置</h3>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">姓名 / 呼称</label>
                <input 
                  type="text" 
                  value={userProfile.name}
                  onChange={(e) => setUserProfile({ ...userProfile, name: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-slate-50/30 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">职级 / 核心角色</label>
                <input 
                  type="text" 
                  value={userProfile.role}
                  onChange={(e) => setUserProfile({ ...userProfile, role: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-slate-50/30 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">归属部门 / 业务线</label>
                <input 
                  type="text" 
                  value={userProfile.department}
                  onChange={(e) => setUserProfile({ ...userProfile, department: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-slate-50/30 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">文本输出偏好语气</label>
                <select 
                  value={userProfile.tonePreference}
                  onChange={(e) => setUserProfile({ ...userProfile, tonePreference: e.target.value as any })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-slate-50/30 focus:bg-white focus:outline-hidden cursor-pointer"
                >
                  <option value="professional">专业严谨 (Corporate Standard)</option>
                  <option value="friendly">热情温和 (Collaborative & Warm)</option>
                  <option value="concise">极其精炼 (Concise & Bullet points)</option>
                  <option value="detailed">极尽详实 (Exhaustive Analysis)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">默认排版格式</label>
                <select 
                  value={userProfile.formatPreference}
                  onChange={(e) => setUserProfile({ ...userProfile, formatPreference: e.target.value as any })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-slate-50/30 focus:bg-white focus:outline-hidden cursor-pointer"
                >
                  <option value="markdown">标准多级标题 Markdown 格式</option>
                  <option value="bullet">扁平化项目符号列表 (Bullet points)</option>
                  <option value="plain">纯文本流式段落 (Plain paragraphs)</option>
                </select>
              </div>

              <div className="border-t border-slate-100 pt-3.5 mt-2 space-y-2">
                <label className="block text-[11px] font-medium text-slate-500">账号登录状态与管理</label>
                <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-150 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isLoggedIn ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                    <span className="font-semibold text-slate-800 text-[11px]">
                      {isLoggedIn ? `已登录: ${userProfile.name}` : "当前未登录"}
                    </span>
                  </div>
                  {isLoggedIn ? (
                    <button
                      onClick={handleLogout}
                      type="button"
                      className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-md text-[10px] font-semibold border border-rose-200 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <LogOut className="w-3 h-3" />
                      <span>退出登录</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowLoginModal(true)}
                      type="button"
                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[10px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <LogIn className="w-3 h-3" />
                      <span>登录账号</span>
                    </button>
                  )}
                </div>
                {isLoggedIn && (
                  <button
                    onClick={() => setShowLoginModal(true)}
                    type="button"
                    className="w-full py-1.5 border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>切换账号身份 / 预设模板</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-4 border-b border-slate-50 pb-3">
              <h3 className="font-display font-semibold text-sm text-slate-800">AI 学习记住的事实习惯</h3>
              <span className="text-[10px] text-slate-400 font-mono">COUNT: {memories.length}</span>
            </div>

            <form onSubmit={handleAddMemory} className="flex gap-2.5 mb-5">
              <div className="flex-1 relative">
                <input 
                  type="text"
                  placeholder="手动向 AI 账本注入新的偏好或偏好事实（例: “用户出差目的地偏向上海”）"
                  value={newMemoryContent}
                  onChange={(e) => setNewMemoryContent(e.target.value)}
                  className="w-full border border-slate-200 text-xs rounded-lg pl-3 pr-20 py-2 text-slate-700 bg-slate-50/50 focus:bg-white focus:outline-hidden"
                />
                <select 
                  value={newMemoryCategory}
                  onChange={(e) => setNewMemoryCategory(e.target.value as any)}
                  className="absolute right-1.5 top-1.5 bg-slate-200 text-slate-600 rounded text-[9px] px-1 py-0.5 border-none cursor-pointer focus:outline-hidden"
                >
                  <option value="preference">习惯偏好</option>
                  <option value="profile">工作背景</option>
                  <option value="schedule">流程排期</option>
                  <option value="system">集成环境</option>
                </select>
              </div>
              <button 
                type="submit"
                className="px-3.5 py-1.5 bg-slate-900 text-white text-xs rounded-lg font-medium hover:bg-slate-850 transition-colors cursor-pointer shrink-0"
              >
                添加认知条目
              </button>
            </form>

            <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
              {memories.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">
                  暂无记忆条目。您可以在上方手动键入添加，或者在与 AI 的多轮会话中，由其自动归纳习得。
                </div>
              ) : (
                memories.map((m) => (
                  <div 
                    key={m.id}
                    className="group flex items-start justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100/50 border border-slate-100 transition-all text-xs"
                  >
                    <div className="flex items-start gap-3 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0 mt-0.5">
                        <span className={`px-1.5 py-0.5 text-[9px] font-semibold font-mono rounded shrink-0 ${
                          m.category === "preference" ? "bg-amber-100 text-amber-800" :
                          m.category === "profile" ? "bg-indigo-100 text-indigo-800" :
                          m.category === "schedule" ? "bg-emerald-100 text-emerald-800" :
                          "bg-slate-200 text-slate-800"
                        }`}>
                          {m.category === "preference" && "个人偏好"}
                          {m.category === "profile" && "工作背景"}
                          {m.category === "schedule" && "工作时间"}
                          {m.category === "system" && "环境设置"}
                        </span>
                        <span className="px-1.5 py-0.5 text-[9px] font-medium font-mono rounded bg-slate-100 text-slate-500 border border-slate-200 shrink-0">
                          置信度: {m.confidence || 95}%
                        </span>
                      </div>
                      <p className="text-slate-700 leading-relaxed font-sans">{m.content}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <span className="text-[9px] text-slate-400 font-mono whitespace-nowrap">
                        {m.createdAt}
                      </span>
                      <button 
                        onClick={() => handleDeleteMemory(m.id)}
                        className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

          </div>
        </div>

      </div>
    </motion.div>
  );
};
