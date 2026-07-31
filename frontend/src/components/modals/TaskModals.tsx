import React from "react";
import { motion } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { 
  X, Eye, Pin, RefreshCw, Clock, FileText, PlayCircle, Trash2, 
  Edit3, Calendar, Sparkles, Terminal, Check 
} from "lucide-react";
import { ScheduleTask, UserProfile } from "../../types";

interface ViewingTaskModalProps {
  viewingTask: ScheduleTask | null;
  setViewingTask: (task: ScheduleTask | null) => void;
  handleDeleteTask: (id: string) => void;
  setEditingTask: (task: ScheduleTask | null) => void;
  setIsEditingTaskOpen: (open: boolean) => void;
  handleRunTask: (task: ScheduleTask) => void;
}

export const ViewingTaskModal: React.FC<ViewingTaskModalProps> = ({
  viewingTask,
  setViewingTask,
  handleDeleteTask,
  setEditingTask,
  setIsEditingTaskOpen,
  handleRunTask,
}) => {
  if (!viewingTask) return null;

  return (
    <motion.div 
      key="modal-view-task"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-xl shadow-lg border border-slate-200 max-w-xl w-full overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-indigo-600" />
            <h3 className="font-display font-semibold text-sm text-slate-800">
              定时计划任务详情
            </h3>
          </div>
          <button 
            type="button"
            onClick={() => setViewingTask(null)} 
            className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs text-slate-600">
          {/* Title */}
          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">计划任务名称</span>
            <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Pin className="w-4 h-4 text-slate-400 shrink-0" />
              <span>{viewingTask.title}</span>
              <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                viewingTask.enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500'
              }`}>
                {viewingTask.enabled ? '已激活调度' : '暂停中'}
              </span>
            </h4>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100 font-sans">
            <div className="space-y-1">
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <RefreshCw className="w-3 h-3 text-slate-400" />
                <span>触发频率</span>
              </span>
              <p className="text-slate-800 font-medium pl-4">
                {viewingTask.scheduleType === 'daily' ? '每天一次' : viewingTask.scheduleType === 'weekly' ? '每周一次' : viewingTask.scheduleType === 'monthly' ? '每月一次' : '单次测试'}
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>设定时间</span>
              </span>
              <p className="text-slate-800 font-medium font-mono flex items-center gap-1 pl-4">
                {viewingTask.timeValue}
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <FileText className="w-3 h-3 text-slate-400" />
                <span>展现格式</span>
              </span>
              <p className="text-slate-800 font-semibold font-mono text-[10px] uppercase pl-4">
                {viewingTask.displayFormat}
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <PlayCircle className="w-3 h-3 text-slate-400" />
                <span>已自动执行</span>
              </span>
              <p className="text-slate-800 font-medium pl-4">
                {viewingTask.runCount}次
              </p>
            </div>
            <div className="space-y-1 col-span-2 border-t border-slate-200/50 pt-2 mt-1">
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <Check className="w-3 h-3 text-slate-400" />
                <span>上次运行时间</span>
              </span>
              <p className="text-slate-700 font-mono text-[11px] pl-4">{viewingTask.lastRunTime || '暂无执行记录'}</p>
            </div>
            {viewingTask.enabled && viewingTask.nextRunTime && (
              <div className="space-y-1 col-span-2">
                <span className="text-emerald-600 font-semibold text-[10px] flex items-center gap-1">
                  <Clock className="w-3 h-3 text-emerald-500" />
                  <span>下次预计执行时间</span>
                </span>
                <p className="text-emerald-700 font-semibold font-mono text-[11px] pl-4">{viewingTask.nextRunTime}</p>
              </div>
            )}
          </div>

          {/* Prompt block */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">后台大模型执行指令 (AI Agent Prompt)</span>
            <div className="bg-slate-900 text-slate-200 font-mono text-[11px] p-3.5 rounded-lg border border-slate-800 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-inner">
              {viewingTask.prompt}
            </div>
          </div>

          {/* Action Panel */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`确定要彻底删除定时任务“${viewingTask.title}”吗？`)) {
                  handleDeleteTask(viewingTask.id);
                  setViewingTask(null);
                }
              }}
              className="w-full sm:w-auto px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 font-semibold rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 border border-red-100/50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>删除任务</span>
            </button>

            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => {
                  setEditingTask({ ...viewingTask });
                  setIsEditingTaskOpen(true);
                  setViewingTask(null);
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 border border-slate-200"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>编辑配置</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  handleRunTask(viewingTask);
                  setViewingTask(null);
                }}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm hover:shadow-md hover:scale-[1.01]"
              >
                <PlayCircle className="w-4 h-4 animate-pulse" />
                <span>立即测试运行</span>
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

interface EditTaskModalProps {
  isEditingTaskOpen: boolean;
  setIsEditingTaskOpen: (open: boolean) => void;
  editingTask: ScheduleTask | null;
  setEditingTask: React.Dispatch<React.SetStateAction<ScheduleTask | null>>;
  handleSaveEditedTask: (e: React.FormEvent) => void;
}

export const EditTaskModal: React.FC<EditTaskModalProps> = ({
  isEditingTaskOpen,
  setIsEditingTaskOpen,
  editingTask,
  setEditingTask,
  handleSaveEditedTask,
}) => {
  if (!isEditingTaskOpen || !editingTask) return null;

  return (
    <motion.div 
      key="modal-edit-task"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-xl shadow-lg border border-slate-200 max-w-xl w-full overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-indigo-600" />
            <h3 className="font-display font-semibold text-sm text-slate-800">
              {editingTask.id.startsWith("task_manual_") ? "手动部署计划任务" : "编辑定时计划任务配置"}
            </h3>
          </div>
          <button 
            type="button"
            onClick={() => { setIsEditingTaskOpen(false); setEditingTask(null); }} 
            className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSaveEditedTask} className="p-5 space-y-4 text-xs text-slate-600">
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-500">任务标题 / 业务名称</label>
            <input 
              type="text"
              required
              value={editingTask.title}
              onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
              placeholder="例如：每日晨间办公报告汇总"
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded-lg px-3 py-2 outline-none font-sans"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-slate-500">运行机制 / 轮询频率</label>
              <select 
                value={editingTask.scheduleType}
                onChange={(e) => setEditingTask({ 
                  ...editingTask, 
                  scheduleType: e.target.value as any,
                  timeValue: e.target.value === 'weekly' ? '周五 17:00' : e.target.value === 'monthly' ? '28日 23:00' : '09:00'
                })}
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded-lg px-3 py-2 outline-none"
              >
                <option value="daily">每天运行 (Daily)</option>
                <option value="weekly">每周运行 (Weekly)</option>
                <option value="monthly">每月运行 (Monthly)</option>
                <option value="once">单次测试 (Once)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-slate-500">运行时间设定</label>
              <input 
                type="text"
                required
                value={editingTask.timeValue}
                onChange={(e) => setEditingTask({ ...editingTask, timeValue: e.target.value })}
                placeholder={editingTask.scheduleType === 'weekly' ? '例如：周五 17:30' : '例如：09:00'}
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded-lg px-3 py-2 outline-none font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-500">运行结果展现格式</label>
            <div className="grid grid-cols-5 gap-2">
              {[
                { key: 'markdown', label: 'MARKDOWN', desc: '美观文档' },
                { key: 'table', label: 'TABLE', desc: '结构化表格' },
                { key: 'bullet', label: 'BULLET', desc: '要点清单' },
                { key: 'email', label: 'EMAIL', desc: '邮件草稿' },
                { key: 'card', label: 'CARD', desc: '精简卡片' }
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setEditingTask({ ...editingTask, displayFormat: item.key as any })}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    editingTask.displayFormat === item.key 
                      ? 'border-slate-900 bg-slate-900 text-white shadow-3xs' 
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="font-mono text-[10px] font-bold leading-none">{item.label}</div>
                  <div className={`text-[8px] mt-1 leading-none ${editingTask.displayFormat === item.key ? 'text-slate-300' : 'text-slate-400'}`}>
                    {item.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-500">后台模型执行指令 (AI Agent Prompt)</label>
            <textarea 
              rows={4}
              required
              value={editingTask.prompt}
              onChange={(e) => setEditingTask({ ...editingTask, prompt: e.target.value })}
              placeholder="在此输入详细的 AI 提示词。例如：读取最近一次 MCP 状态，自动整理最近三天的客户反馈，并将其格式化输出..."
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 rounded-lg px-3 py-2 outline-none font-mono leading-relaxed"
            />
            <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-1">
              <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
              <span>提示：该任务运行时将自动读取已连接的 MCP 服务器工具以及您的个人记忆画像进行优化。</span>
            </span>
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-50">
            <button 
              type="button"
              onClick={() => { setIsEditingTaskOpen(false); setEditingTask(null); }}
              className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-lg font-medium transition-all cursor-pointer"
            >
              取消
            </button>
            <button 
              type="submit"
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold transition-all shadow-2xs cursor-pointer"
            >
              保存并激活
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

interface RunningTaskModalProps {
  runningTask: ScheduleTask | null;
  runningTaskLogs: string[];
  runningTaskResult: { title: string; content: string; displayFormat: string } | null;
  setRunningTaskResult: (res: { title: string; content: string; displayFormat: string } | null) => void;
  userProfile: UserProfile;
}

export const RunningTaskModal: React.FC<RunningTaskModalProps> = ({
  runningTask,
  runningTaskLogs,
  runningTaskResult,
  setRunningTaskResult,
  userProfile,
}) => {
  if (!runningTask && !runningTaskResult) return null;

  return (
    <motion.div 
      key="modal-running-task"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-xl shadow-lg border border-slate-200 max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-indigo-600" />
            <h3 className="font-display font-semibold text-sm text-slate-800 flex items-center gap-1.5">
              <span>定时任务沙盒测试：</span>
              <strong className="text-slate-950">{runningTask ? runningTask.title : runningTaskResult?.title}</strong>
            </h3>
          </div>
          {!runningTask && (
            <button 
              onClick={() => setRunningTaskResult(null)} 
              className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
          {runningTask && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/50">
                <Sparkles className="w-5 h-5 text-indigo-600 animate-spin shrink-0" />
                <div className="text-xs">
                  <h4 className="font-semibold text-indigo-900">正在按调度策略模拟后台运行中...</h4>
                  <p className="text-indigo-600/75 mt-0.5 font-mono">Status: INFERENCE_PIPELINE_ACTIVE</p>
                </div>
              </div>

              <div className="bg-slate-950 text-emerald-400 p-4 rounded-xl font-mono text-xs space-y-1.5 shadow-inner border border-slate-800 h-64 overflow-y-auto leading-relaxed">
                {runningTaskLogs.map((log, index) => (
                  <div key={index} className="animate-fade-in">{log}</div>
                ))}
                <div className="flex items-center gap-1 text-slate-500 animate-pulse mt-2">
                  <span>●</span>
                  <span>等待核心节点流返回...</span>
                </div>
              </div>
            </div>
          )}

          {runningTaskResult && (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-lg border border-emerald-150 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span><strong>沙盒触发测试成功</strong>！大模型完美解析了指令，并渲染了高品质的 <strong>{runningTaskResult.displayFormat.toUpperCase()}</strong> 文件。</span>
                </div>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-mono px-2 py-0.5 rounded font-bold">100% SUCCESS</span>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                {runningTaskResult.displayFormat === 'email' ? (
                  <div className="bg-slate-50/60 text-xs text-slate-600 divide-y divide-slate-100 font-sans">
                    <div className="p-3 flex items-center gap-2">
                      <span className="font-semibold text-slate-400 w-12 text-right">主题:</span>
                      <span className="font-semibold text-slate-800">{runningTaskResult.title} (企业日报推送)</span>
                    </div>
                    <div className="p-3 flex items-center gap-2">
                      <span className="font-semibold text-slate-400 w-12 text-right">发件人:</span>
                      <span className="text-slate-800 font-mono">AgentScheduler@office-hub.internal</span>
                    </div>
                    <div className="p-3 flex items-center gap-2">
                      <span className="font-semibold text-slate-400 w-12 text-right">收件人:</span>
                      <span className="text-slate-800 font-mono">{userProfile.name} &lt;{userProfile.name}@enterprise.ai&gt;</span>
                    </div>
                    <div className="p-5 bg-white overflow-y-auto max-h-96 leading-relaxed text-slate-800 font-sans">
                      <Markdown remarkPlugins={[remarkGfm]}>{runningTaskResult.content}</Markdown>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 overflow-y-auto max-h-96 leading-relaxed font-sans markdown-body bg-white text-slate-800">
                    <Markdown remarkPlugins={[remarkGfm]}>{runningTaskResult.content}</Markdown>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {!runningTask && (
          <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex justify-end shrink-0">
            <button 
              type="button"
              onClick={() => setRunningTaskResult(null)}
              className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-all shadow-2xs cursor-pointer"
            >
              关闭结果预览
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};
