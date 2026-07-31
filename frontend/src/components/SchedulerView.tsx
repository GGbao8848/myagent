import React from "react";
import { motion } from "motion/react";
import { 
  Calendar, Info, Plus, Play, Pause, Trash2, Pin, Clock, ChevronRight 
} from "lucide-react";
import { ScheduleTask } from "../types";

interface SchedulerViewProps {
  showTips: boolean;
  toggleShowTips: () => void;
  setEditingTask: (task: ScheduleTask | null) => void;
  setIsEditingTaskOpen: (open: boolean) => void;
  scheduleTasks: ScheduleTask[];
  selectedTaskIds: string[];
  handleSelectAllTasks: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleBatchEnableTasks: () => void;
  handleBatchPauseTasks: () => void;
  handleBatchDeleteTasks: () => void;
  setViewingTask: (task: ScheduleTask | null) => void;
  handleToggleSelectTask: (id: string) => void;
  handleToggleTask: (id: string) => void;
}

export const SchedulerView: React.FC<SchedulerViewProps> = ({
  showTips,
  toggleShowTips,
  setEditingTask,
  setIsEditingTaskOpen,
  scheduleTasks,
  selectedTaskIds,
  handleSelectAllTasks,
  handleBatchEnableTasks,
  handleBatchPauseTasks,
  handleBatchDeleteTasks,
  setViewingTask,
  handleToggleSelectTask,
  handleToggleTask,
}) => {
  return (
    <motion.div 
      key="scheduler-view"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.15 }}
      className="p-6 overflow-hidden h-full flex flex-col"
    >
      <div className="max-w-7xl mx-auto w-full flex flex-col h-full space-y-4 overflow-hidden">
        
        {/* Header banner */}
        <div className="border-b border-slate-100 pb-3.5 shrink-0 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-display font-semibold text-slate-900 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-500 shrink-0" />
              <span>智能日程与计划任务</span>
              <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-mono border border-indigo-100/50">Enterprise Scheduler v2.1</span>
            </h2>
            {showTips && (
              <p className="text-xs text-slate-500 mt-0.5 animate-fade-in">
                通过与专属 Agent 规划助理对话或手动配置，让 AI 定期自动运行复杂提示词指令，拉取多端 MCP 服务器工具并生成高品质报告。
              </p>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
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

            <button
              onClick={() => {
                setEditingTask({
                  id: "task_manual_" + Date.now(),
                  title: "未命名自定义定时任务",
                  scheduleType: "daily",
                  timeValue: "09:00",
                  prompt: "拉取最新的已关联数据，并总结今日核心改进建议。",
                  displayFormat: "markdown",
                  enabled: true,
                  createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
                  runCount: 0
                });
                setIsEditingTaskOpen(true);
              }}
              className="px-3.5 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> <span>手动创建任务</span>
            </button>
          </div>
        </div>

        {/* Single Full-width Panel: Scheduled Tasks List */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden mt-2">
          <div className="mb-3.5 shrink-0 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">计划任务列表 ({scheduleTasks.length})</span>
            <span className="text-[10px] text-slate-400 font-mono">定时调度线程就绪 ●</span>
          </div>

          {scheduleTasks.length > 0 && (
            <div className="mb-3 bg-slate-50/70 border border-slate-150 rounded-xl p-2 px-3 flex flex-wrap items-center justify-between gap-2.5 shadow-3xs animate-fade-in text-xs">
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox"
                  checked={scheduleTasks.length > 0 && selectedTaskIds.length === scheduleTasks.length}
                  onChange={handleSelectAllTasks}
                  className="w-3.5 h-3.5 accent-indigo-600 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  id="batch-select-all"
                />
                <label htmlFor="batch-select-all" className="font-medium text-slate-600 select-none cursor-pointer">
                  全选
                </label>
                {selectedTaskIds.length > 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-indigo-100 text-indigo-700 rounded-full font-mono">
                    已选 {selectedTaskIds.length} 项
                  </span>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBatchEnableTasks}
                  disabled={selectedTaskIds.length === 0}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    selectedTaskIds.length > 0 
                      ? "bg-white hover:bg-emerald-50 text-emerald-600 border border-emerald-200/50 hover:border-emerald-300 shadow-3xs cursor-pointer" 
                      : "text-slate-400 bg-slate-100/50 border border-transparent cursor-not-allowed"
                  }`}
                >
                  <Play className="w-3 h-3" />
                  <span>批量激活</span>
                </button>
                
                <button
                  type="button"
                  onClick={handleBatchPauseTasks}
                  disabled={selectedTaskIds.length === 0}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    selectedTaskIds.length > 0 
                      ? "bg-white hover:bg-amber-50 text-amber-600 border border-amber-200/50 hover:border-amber-300 shadow-3xs cursor-pointer" 
                      : "text-slate-400 bg-slate-100/50 border border-transparent cursor-not-allowed"
                  }`}
                >
                  <Pause className="w-3 h-3" />
                  <span>批量暂停</span>
                </button>
                
                <button
                  type="button"
                  onClick={handleBatchDeleteTasks}
                  disabled={selectedTaskIds.length === 0}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    selectedTaskIds.length > 0 
                      ? "bg-red-50 hover:bg-red-100 text-red-600 border border-red-100/50 hover:border-red-200 shadow-3xs cursor-pointer" 
                      : "text-slate-400 bg-slate-100/50 border border-transparent cursor-not-allowed"
                  }`}
                >
                  <Trash2 className="w-3 h-3" />
                  <span>批量删除</span>
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto pr-1.5 pb-6">
            {scheduleTasks.length === 0 ? (
              <div className="bg-white border border-dashed border-slate-200 rounded-xl p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 mx-auto">
                  <Calendar className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-700">暂无任何计划任务</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                    点击右上角 “手动创建任务” 即可将复杂工作流绑定为定期自动执行的计划。
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {scheduleTasks.map((task) => (
                  <div 
                    key={task.id}
                    onClick={() => setViewingTask(task)}
                    className={`bg-white border rounded-xl p-4 transition-all duration-200 hover:border-indigo-300 hover:shadow-xs cursor-pointer relative group flex flex-col justify-between ${
                      selectedTaskIds.includes(task.id)
                        ? "border-indigo-400 bg-indigo-50/10 shadow-xs"
                        : task.enabled ? "border-slate-200 shadow-3xs" : "border-slate-150 bg-slate-50/30 opacity-75"
                    }`}
                  >
                    <div className="flex flex-col space-y-3">
                      {/* Header: Title & Switch */}
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div onClick={(e) => e.stopPropagation()} className="flex items-center shrink-0 mt-0.5">
                            <input 
                              type="checkbox"
                              checked={selectedTaskIds.includes(task.id)}
                              onChange={() => handleToggleSelectTask(task.id)}
                              className="w-3.5 h-3.5 accent-indigo-600 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                          </div>
                          <h3 className="font-semibold text-slate-800 text-xs truncate max-w-[150px] group-hover:text-indigo-600 transition-colors flex items-center gap-1" title={task.title}>
                            <Pin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{task.title}</span>
                          </h3>
                        </div>
                        
                        {/* Toggle Switch */}
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <span className={`text-[9px] font-medium font-mono ${task.enabled ? "text-emerald-600" : "text-slate-400"}`}>
                            {task.enabled ? "已激活" : "暂停"}
                          </span>
                          <button 
                            onClick={() => handleToggleTask(task.id)}
                            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              task.enabled ? "bg-slate-900" : "bg-slate-200"
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                                task.enabled ? "translate-x-3" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      {/* Meta details row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          task.displayFormat === 'table' ? 'bg-amber-50 text-amber-700 border border-amber-100/50' :
                          task.displayFormat === 'email' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100/50' :
                          task.displayFormat === 'bullet' ? 'bg-teal-50 text-teal-700 border border-teal-100/50' :
                          'bg-slate-50 text-slate-600 border border-slate-200/50'
                        }`}>
                          {task.displayFormat.toUpperCase()}
                        </span>

                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          task.scheduleType === 'daily' ? 'bg-sky-50 text-sky-700' :
                          task.scheduleType === 'weekly' ? 'bg-indigo-50 text-indigo-700' :
                          task.scheduleType === 'monthly' ? 'bg-purple-50 text-purple-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {task.scheduleType === 'daily' ? '每天' : task.scheduleType === 'weekly' ? '每周' : task.scheduleType === 'monthly' ? '每月' : '单次'}
                        </span>

                        <span className="flex items-center gap-0.5 text-indigo-600 font-medium font-mono text-[10px]">
                          <Clock className="w-3 h-3 text-indigo-500" />
                          {task.timeValue}
                        </span>
                      </div>

                      {/* Bottom meta details */}
                      <div className="flex items-center justify-between pt-2.5 border-t border-slate-50 text-[10px] text-slate-400 font-mono mt-2">
                        <div className="flex items-center gap-2">
                          <span>已运行: <strong className="text-slate-600 font-semibold">{task.runCount}次</strong></span>
                          {task.lastRunTime && (
                            <span className="opacity-75">| 上次: {task.lastRunTime.split(' ')[1] || task.lastRunTime}</span>
                          )}
                        </div>
                        <span className="text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity font-semibold flex items-center gap-0.5">
                          <span>查看</span>
                          <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </motion.div>
  );
};
