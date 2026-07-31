import React from "react";
import { motion } from "motion/react";
import { LogIn, ShieldCheck, Sparkles, KeyRound } from "lucide-react";
import { startLogin } from "../auth";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl"></div>
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-emerald-600/20 rounded-full blur-3xl"></div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md px-8"
      >
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-10 border border-white/10 shadow-2xl">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-emerald-500 rounded-2xl flex items-center justify-center mb-5 shadow-lg shadow-indigo-500/30">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white font-display">BR Agent</h1>
            <p className="text-sm text-slate-400 mt-2">企业 AI 智能体办公自动化平台</p>
          </div>

          <div className="space-y-3 mb-8 text-slate-300 text-sm">
            <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>通过企业统一身份认证（Keycloak）安全登录</span>
            </div>
            <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
              <KeyRound className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>登录后自动同步你的个人画像、技能与记忆</span>
            </div>
          </div>

          <button
            onClick={() => startLogin()}
            className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-semibold rounded-2xl transition-all shadow-lg shadow-indigo-500/30 flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogIn className="w-4 h-4" />
            使用企业账号登录
          </button>

          <p className="text-xs text-slate-500 text-center mt-6">
            登录即代表您同意遵守企业信息安全规范
          </p>
        </div>
      </motion.div>
    </div>
  );
}
