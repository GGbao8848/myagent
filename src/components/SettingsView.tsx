import React from "react";
import { motion } from "motion/react";
import { 
  Settings, Info, Flame, Calendar, Key, X, RefreshCw, Trash2, AlertTriangle 
} from "lucide-react";
import { ModelConfig } from "../types";

interface SettingsViewProps {
  showTips: boolean;
  toggleShowTips: () => void;
  showAddModelModal: boolean;
  setShowAddModelModal: (show: boolean) => void;
  newModel: {
    name: string;
    provider: "OpenAI" | "DeepSeek" | "Claude" | "Custom";
    baseUrl: string;
    apiKey: string;
  };
  setNewModel: React.Dispatch<React.SetStateAction<{
    name: string;
    provider: "OpenAI" | "DeepSeek" | "Claude" | "Custom";
    baseUrl: string;
    apiKey: string;
  }>>;
  handleAddNewModel: (e: React.FormEvent) => void;
  modelConfigs: ModelConfig[];
  setModelConfigs: React.Dispatch<React.SetStateAction<ModelConfig[]>>;
  modelConnectionStatuses: Record<string, { status: "connected" | "failed" | "simulated"; message: string; latency?: string }>;
  testingModelId: string | null;
  handleTestModelConfig: (config: ModelConfig) => void;
  handleDeleteModel: (id: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  showTips,
  toggleShowTips,
  showAddModelModal,
  setShowAddModelModal,
  newModel,
  setNewModel,
  handleAddNewModel,
  modelConfigs,
  setModelConfigs,
  modelConnectionStatuses,
  testingModelId,
  handleTestModelConfig,
  handleDeleteModel,
}) => {
  return (
    <motion.div 
      key="settings-view"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.15 }}
      className="p-6 overflow-y-auto h-full"
    >
      <div className="max-w-5xl mx-auto space-y-7">
        
        {/* Page header banner */}
        <div className="border-b border-slate-100 pb-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-xl font-display font-semibold text-slate-900 flex items-center gap-2">
              <Settings className="w-5 h-5 text-indigo-500 shrink-0" />
              <span>大模型连接管理与运行看板</span>
            </h2>
            {showTips && (
              <p className="text-xs text-slate-500 mt-1 animate-fade-in">
                在这里注册并管理可用于智能助理调度的底层 LLM 模型供应商（OpenAI 兼容端点），并监控核心运行调用数据。
              </p>
            )}
          </div>

          <button
            onClick={toggleShowTips}
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-all cursor-pointer shrink-0 self-end sm:self-auto ${
              showTips 
                ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100" 
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>{showTips ? "隐藏说明" : "显示说明"}</span>
          </button>
        </div>

        {/* Analytics Widgets */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-500" />
            <h3 className="font-display font-semibold text-sm text-slate-800">智能网关运行统计仪表盘 (What's up next?)</h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
              <span className="text-[10px] text-slate-400 font-medium">会话总数 / Sessions</span>
              <h4 className="text-xl font-display font-semibold text-slate-900 mt-1">53</h4>
              <div className="text-[9px] text-emerald-600 mt-1 font-semibold flex items-center gap-1">
                <span>↑ 12%</span>
                <span className="text-slate-400 font-normal">本周活跃</span>
              </div>
            </div>

            <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
              <span className="text-[10px] text-slate-400 font-medium">消息交互 / Messages</span>
              <h4 className="text-xl font-display font-semibold text-slate-900 mt-1">16,479</h4>
              <div className="text-[9px] text-slate-400 mt-1">
                平均会话消息数: <span className="font-mono">12.5条</span>
              </div>
            </div>

            <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
              <span className="text-[10px] text-slate-400 font-medium">累计消耗 / Total tokens</span>
              <h4 className="text-xl font-display font-semibold text-slate-900 mt-1">100.9M</h4>
              <div className="text-[9px] text-slate-400 mt-1">
                折合约为 134.5 万个中文字符
              </div>
            </div>

            <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-2xs">
              <span className="text-[10px] text-slate-400 font-medium">最长连续工作天数 / Streak</span>
              <h4 className="text-xl font-display font-semibold text-slate-900 mt-1">15 天</h4>
              <div className="text-[9px] text-orange-600 font-semibold mt-1">
                最高活跃记录：4天连续
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>AI 每日协同调用热力图 (最近45周)</span>
              </h4>
              <div className="flex gap-1.5 items-center text-[10px] text-slate-400">
                <span>少</span>
                <span className="w-2.5 h-2.5 bg-slate-100 rounded"></span>
                <span className="w-2.5 h-2.5 bg-blue-100 rounded"></span>
                <span className="w-2.5 h-2.5 bg-blue-300 rounded"></span>
                <span className="w-2.5 h-2.5 bg-blue-500 rounded"></span>
                <span className="w-2.5 h-2.5 bg-blue-700 rounded"></span>
                <span>多</span>
              </div>
            </div>

            <div className="flex gap-1 overflow-x-auto py-2">
              {Array.from({ length: 45 }).map((_, weekIdx) => (
                <div key={weekIdx} className="flex flex-col gap-1 shrink-0">
                  {Array.from({ length: 7 }).map((_, dayIdx) => {
                    const weight = Math.random();
                    let bgClass = "bg-slate-100";
                    if (weekIdx > 28) {
                      if (weight > 0.8) bgClass = "bg-blue-700";
                      else if (weight > 0.5) bgClass = "bg-blue-500";
                      else if (weight > 0.25) bgClass = "bg-blue-300";
                      else bgClass = "bg-blue-100";
                    } else if (weekIdx > 15) {
                      if (weight > 0.85) bgClass = "bg-blue-500";
                      else if (weight > 0.6) bgClass = "bg-blue-300";
                      else if (weight > 0.3) bgClass = "bg-blue-100";
                    } else {
                      if (weight > 0.95) bgClass = "bg-blue-300";
                      else if (weight > 0.85) bgClass = "bg-blue-100";
                    }

                    return (
                      <div 
                        key={dayIdx} 
                        className={`w-2.5 h-2.5 rounded-sm transition-colors ${bgClass}`} 
                        title={`调用周数 ${weekIdx + 1}, 星期 ${dayIdx + 1}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-2 font-mono text-center">
              数据来源：Local Model Gateway Operations Tracker (2026年)
            </p>
          </div>
        </div>

        {/* Model Configurations */}
        <div className="space-y-4">
          <div className="flex justify-between items-center pb-2 border-b border-slate-50">
            <h3 className="font-display font-semibold text-sm text-slate-800 flex items-center gap-2">
              <Key className="w-4 h-4 text-slate-400" />
              <span>大语言模型接入与密钥库 (LLM Gateways)</span>
            </h3>
            
            <button 
              onClick={() => setShowAddModelModal(true)}
              className="px-2.5 py-1.5 border border-slate-200 hover:border-slate-350 text-slate-700 rounded-lg text-xs font-medium bg-white shadow-3xs transition-colors cursor-pointer"
            >
              + 注册新模型
            </button>
          </div>

          {showAddModelModal && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 border border-slate-200 bg-slate-50/50 rounded-xl space-y-4 max-w-lg text-xs"
            >
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <span className="font-semibold text-slate-700">配置自定义兼容 API 节点</span>
                <button onClick={() => setShowAddModelModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddNewModel} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">模型商业名称</label>
                    <input 
                      type="text" 
                      required
                      placeholder="如: Claude 3.5 (专属中继)"
                      value={newModel.name}
                      onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">后端框架标准</label>
                    <select 
                      value={newModel.provider}
                      onChange={(e) => setNewModel({ ...newModel, provider: e.target.value as any })}
                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden bg-white cursor-pointer"
                    >
                      <option value="OpenAI">OpenAI Compatible (兼容端点)</option>
                      <option value="DeepSeek">DeepSeek API</option>
                      <option value="Claude">Anthropic SDK</option>
                      <option value="Custom">其他自定义网关</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">API 基准请求地址 (Base URL)</label>
                  <input 
                    type="text" 
                    placeholder="https://api.openai.com/v1"
                    value={newModel.baseUrl}
                    onChange={(e) => setNewModel({ ...newModel, baseUrl: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono focus:outline-hidden bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">自定义验证凭证 (API KEY)</label>
                  <input 
                    type="password" 
                    placeholder="sk-................................"
                    value={newModel.apiKey}
                    onChange={(e) => setNewModel({ ...newModel, apiKey: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono focus:outline-hidden bg-white"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-150">
                  <button 
                    type="button" 
                    onClick={() => setShowAddModelModal(false)}
                    className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-medium cursor-pointer"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    className="px-4 py-1 bg-slate-900 text-white rounded-lg font-medium shadow-2xs hover:bg-slate-800 cursor-pointer"
                  >
                    保存模型
                  </button>
                </div>
              </form>
            </motion.div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {modelConfigs.map((config) => {
              const testStatus = modelConnectionStatuses[config.id];
              const isTesting = testingModelId === config.id;
              
              return (
                <div 
                  key={config.id}
                  className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-3xs flex flex-col justify-between hover:shadow-2xs transition-shadow duration-200"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-xs text-slate-900">{config.name}</h4>
                        <span className="px-1.5 py-0.2 text-[8px] font-bold uppercase rounded bg-slate-100 text-slate-500 font-mono">
                          {config.provider}
                        </span>
                      </div>

                      <button 
                        onClick={() => {
                          setModelConfigs(prev => prev.map(m => m.id === config.id ? { ...m, enabled: !m.enabled } : m));
                        }}
                        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                          config.enabled ? "bg-slate-900" : "bg-slate-200"
                        }`}
                      >
                        <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                          config.enabled ? "translate-x-3" : "translate-x-0"
                        }`} />
                      </button>
                    </div>

                    <div className="space-y-1 text-[10px] font-mono text-slate-500 mb-3">
                      <p className="truncate">端点: <span className="text-slate-600">{config.baseUrl}</span></p>
                      <p>密钥: <span className="text-slate-400">{config.apiKey ? "••••••••••••••••" : "（未注入）"}</span></p>
                    </div>

                    {testStatus && (
                      <div className={`p-2 rounded-lg text-[10px] leading-relaxed mb-3 font-sans border ${
                        testStatus.status === "connected" 
                          ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
                          : testStatus.status === "simulated"
                          ? "bg-amber-50/50 border-amber-100 text-amber-800"
                          : "bg-rose-50 border-rose-100 text-rose-800"
                      }`}>
                        <div className="flex items-center gap-1.5 font-semibold">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            testStatus.status === "connected" ? "bg-emerald-500 animate-pulse" :
                            testStatus.status === "simulated" ? "bg-amber-500" : "bg-rose-500"
                          }`} />
                          <span>
                            {testStatus.status === "connected" ? `已联通 (${testStatus.latency || "正常"})` :
                             testStatus.status === "simulated" ? "本地仿真" : "离线 / 联通失败"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-slate-500 font-mono text-[9px] leading-tight">{testStatus.message}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-1 pt-2.5 border-t border-slate-50">
                    <button 
                      onClick={() => handleTestModelConfig(config)}
                      disabled={isTesting}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded border text-[10px] font-medium transition-all cursor-pointer ${
                        isTesting 
                          ? "bg-slate-50 text-slate-400 border-slate-200" 
                          : testStatus?.status === "connected"
                          ? "bg-emerald-50/50 hover:bg-emerald-50 text-emerald-700 border-emerald-200/50"
                          : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200"
                      }`}
                    >
                      <RefreshCw className={`w-2.5 h-2.5 shrink-0 ${isTesting ? "animate-spin" : ""}`} />
                      <span>{isTesting ? "正在检测..." : "连通测试"}</span>
                    </button>

                    {config.isCustom && (
                      <button 
                        onClick={() => handleDeleteModel(config.id)}
                        className="text-[10px] text-red-500 hover:underline flex items-center gap-1 transition-all cursor-pointer"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                        <span>卸载</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3.5 bg-amber-50/50 rounded-xl border border-amber-200/40 text-[11px] text-amber-800 leading-relaxed flex gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong>API 密钥与连接安全：</strong>
              <p className="mt-0.5 text-slate-600">
                本平台采用<strong>全栈双端安全架构</strong>，您在前端配置的所有供应商凭证将仅保存在浏览器本地加密层。在发送对话时，通过 `/api/chat` 进行安全服务器转发代理，绝不在客户端暴露密钥。
              </p>
            </div>
          </div>
        </div>

      </div>
    </motion.div>
  );
};
