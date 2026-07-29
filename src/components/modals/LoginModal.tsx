import React from "react";
import { motion } from "motion/react";
import { 
  X, Sparkles, Key, Smartphone, AlertTriangle, UserCheck 
} from "lucide-react";
import { UserProfile } from "../../types";

interface LoginModalProps {
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  isLoggedIn: boolean;
  presetUsers: Array<{
    name: string;
    role: string;
    department: string;
    tonePreference: string;
    formatPreference: string;
    email: string;
    avatarBg: string;
  }>;
  userProfile: UserProfile;
  loginTab: "quick" | "password" | "phone";
  setLoginTab: (tab: "quick" | "password" | "phone") => void;
  loginFormName: string;
  setLoginFormName: (v: string) => void;
  loginFormPassword: string;
  setLoginFormPassword: (v: string) => void;
  loginFormPhone: string;
  setLoginFormPhone: (v: string) => void;
  loginFormCode: string;
  setLoginFormCode: (v: string) => void;
  loginFormRole: string;
  setLoginFormRole: (v: string) => void;
  loginFormDept: string;
  setLoginFormDept: (v: string) => void;
  loginError: string | null;
  setLoginError: (err: string | null) => void;
  smsCountdown: number;
  handleSendSmsCode: () => void;
  handleLoginPreset: (preset: any) => void;
  handleLoginSubmit: (e: React.FormEvent) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  showLoginModal,
  setShowLoginModal,
  isLoggedIn,
  presetUsers,
  userProfile,
  loginTab,
  setLoginTab,
  loginFormName,
  setLoginFormName,
  loginFormPassword,
  setLoginFormPassword,
  loginFormPhone,
  setLoginFormPhone,
  loginFormCode,
  setLoginFormCode,
  loginFormRole,
  setLoginFormRole,
  loginFormDept,
  setLoginFormDept,
  loginError,
  setLoginError,
  smsCountdown,
  handleSendSmsCode,
  handleLoginPreset,
  handleLoginSubmit,
}) => {
  if (!showLoginModal) return null;

  return (
    <motion.div 
      key="modal-login"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 15 }}
        className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl max-w-lg w-full relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500"></div>

        <div className="flex justify-between items-start border-b border-slate-100 pb-4 mt-1">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                <UserCheck className="w-5 h-5" />
              </div>
              <h3 className="font-display font-semibold text-base text-slate-900">
                {isLoggedIn ? "切换账号 / 身份登录" : "用户登录 / 注册认证"}
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              登录后将自动同步个人认知偏好、自定义技能包与 MCP 工具配置
            </p>
          </div>
          <button 
            onClick={() => { setShowLoginModal(false); setLoginError(null); }} 
            className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex bg-slate-100/80 p-1 rounded-xl mt-4 text-xs font-medium text-slate-600">
          <button 
            type="button"
            onClick={() => { setLoginTab("quick"); setLoginError(null); }}
            className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              loginTab === "quick" ? "bg-white text-indigo-600 font-semibold shadow-xs" : "hover:text-slate-900"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            <span>一键预设身份</span>
          </button>
          <button 
            type="button"
            onClick={() => { setLoginTab("password"); setLoginError(null); }}
            className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              loginTab === "password" ? "bg-white text-indigo-600 font-semibold shadow-xs" : "hover:text-slate-900"
            }`}
          >
            <Key className="w-3.5 h-3.5 text-slate-500" />
            <span>账号密码登录</span>
          </button>
          <button 
            type="button"
            onClick={() => { setLoginTab("phone"); setLoginError(null); }}
            className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              loginTab === "phone" ? "bg-white text-indigo-600 font-semibold shadow-xs" : "hover:text-slate-900"
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-slate-500" />
            <span>手机验证码</span>
          </button>
        </div>

        <div className="mt-4">
          {loginTab === "quick" && (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                点击下方适合的演示角色一键快速登录或切换，体验针对不同角色的差异化 AI 决策支持：
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pr-1">
                {presetUsers.map((preset) => (
                  <div 
                    key={preset.name}
                    onClick={() => handleLoginPreset(preset)}
                    className={`p-3 border rounded-xl cursor-pointer transition-all hover:border-indigo-300 hover:shadow-xs group ${
                      userProfile.name === preset.name && isLoggedIn
                        ? "border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-500"
                        : "border-slate-200 bg-slate-50/50 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <div className={`w-8 h-8 rounded-full ${preset.avatarBg} flex items-center justify-center font-bold text-xs shadow-xs`}>
                        {preset.name.slice(0, 1)}
                      </div>
                      <div>
                        <div className="font-semibold text-xs text-slate-800 flex items-center gap-1">
                          <span>{preset.name}</span>
                          {userProfile.name === preset.name && isLoggedIn && (
                            <span className="text-[9px] bg-indigo-600 text-white px-1 rounded font-normal">当前</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono truncate">{preset.role}</div>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-400 border-t border-slate-100 pt-1.5 flex items-center justify-between">
                      <span>{preset.department}</span>
                      <span className="text-indigo-600 group-hover:translate-x-0.5 transition-transform font-medium">登录 →</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loginTab === "password" && (
            <form onSubmit={handleLoginSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">用户名 / 企业邮箱</label>
                <input 
                  type="text" 
                  required
                  placeholder="例如：zhangsan@enterprise.ai 或 张三"
                  value={loginFormName}
                  onChange={(e) => setLoginFormName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">登录密码</label>
                <input 
                  type="password" 
                  required
                  placeholder="••••••••"
                  value={loginFormPassword}
                  onChange={(e) => setLoginFormPassword(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">职级角色 (可选)</label>
                  <input 
                    type="text" 
                    placeholder="例如：高级架构师"
                    value={loginFormRole}
                    onChange={(e) => setLoginFormRole(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">归属部门 (可选)</label>
                  <input 
                    type="text" 
                    placeholder="例如：研发中心"
                    value={loginFormDept}
                    onChange={(e) => setLoginFormDept(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </div>

              {loginError && (
                <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-xl text-[11px] text-rose-600 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
                  <span>{loginError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={() => setShowLoginModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-xs transition-all cursor-pointer"
                >
                  确定登录
                </button>
              </div>
            </form>
          )}

          {loginTab === "phone" && (
            <form onSubmit={handleLoginSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">手机号码</label>
                <input 
                  type="tel" 
                  required
                  placeholder="请输入 11 位手机号码"
                  value={loginFormPhone}
                  onChange={(e) => setLoginFormPhone(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">短信验证码</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    required
                    placeholder="6 位数字验证码"
                    value={loginFormCode}
                    onChange={(e) => setLoginFormCode(e.target.value)}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    disabled={smsCountdown > 0}
                    onClick={handleSendSmsCode}
                    className={`px-3 py-2 rounded-xl border text-xs font-medium shrink-0 transition-all cursor-pointer ${
                      smsCountdown > 0
                        ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                        : "bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100"
                    }`}
                  >
                    {smsCountdown > 0 ? `${smsCountdown}s 后重发` : "获取验证码"}
                  </button>
                </div>
              </div>

              {loginError && (
                <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-xl text-[11px] text-rose-600 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
                  <span>{loginError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={() => setShowLoginModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-xs transition-all cursor-pointer"
                >
                  验证并登录
                </button>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
