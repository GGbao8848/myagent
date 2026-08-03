import React from "react";
import { motion } from "motion/react";
import { 
  Wrench, Info, Upload, Trash2, HelpCircle 
} from "lucide-react";
import { Skill } from "../types";

interface SkillsViewProps {
  showTips: boolean;
  toggleShowTips: () => void;
  setShowUploadSkillModal: (show: boolean) => void;
  skills: Skill[];
  handleToggleSkill: (id: string) => void;
  handleDeleteSkill: (id: string) => void;
}

export const SkillsView: React.FC<SkillsViewProps> = ({
  showTips,
  toggleShowTips,
  setShowUploadSkillModal,
  skills,
  handleToggleSkill,
  handleDeleteSkill,
}) => {
  const renderCategoryTag = (category: string) => {
    switch (category) {
      case 'document':
        return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-700 border border-amber-100">文档研读</span>;
      case 'coding':
        return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-50 text-emerald-700 border border-emerald-100">代码工程</span>;
      case 'office':
        return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-indigo-50 text-indigo-700 border border-indigo-100">综合办公</span>;
      case 'utility':
        return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-50 text-purple-700 border border-purple-100">数据分析</span>;
      default:
        return <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-700 border border-slate-200">自定义</span>;
    }
  };

  return (
    <motion.div 
      key="skills-view"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.15 }}
      className="p-6 overflow-y-auto h-full"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Page Header banner */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-5">
          <div>
            <h2 className="text-xl font-display font-semibold text-slate-900 flex items-center gap-2">
              <Wrench className="w-5 h-5 text-indigo-500 shrink-0" />
              <span>办公技能包管理中心</span>
            </h2>
            {showTips && (
              <p className="text-xs text-slate-500 mt-1 animate-fade-in">
                启用、禁用或调试大模型的自动化工具库。支持直接上传打包好的 `.zip` 或 `.json` 自定义技能模板。
              </p>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto">
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
              onClick={() => setShowUploadSkillModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>上传自定义技能包</span>
            </button>
          </div>
        </div>

        {/* Skills Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {skills.map((skill) => (
            <div 
              key={skill.id}
              className={`bg-white border rounded-xl p-5 shadow-2xs relative flex flex-col justify-between transition-all ${
                skill.enabled 
                  ? "border-slate-200" 
                  : "border-slate-100 opacity-75"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display font-semibold text-sm text-slate-800">{skill.name}</h3>
                  <div className="flex items-center gap-2">
                    {renderCategoryTag(skill.category)}
                    
                    <button 
                      onClick={() => handleToggleSkill(skill.id)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        skill.enabled ? "bg-slate-900" : "bg-slate-200"
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        skill.enabled ? "translate-x-4" : "translate-x-0"
                      }`} />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-500 leading-normal mb-2">
                  {skill.description}
                </p>
              </div>

              {skill.isCustom && (
                <div className="mt-3 text-right">
                  <button
                    onClick={() => handleDeleteSkill(skill.id)}
                    className="text-[10px] text-red-500 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>卸载此自定义技能</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {showTips && (
          <div className="p-4 bg-slate-50/60 rounded-xl border border-slate-100 text-xs text-slate-500 flex gap-3.5 animate-fade-in">
            <HelpCircle className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-slate-700 mb-0.5">如何使技能在会话中生效？</h4>
              <p className="leading-relaxed">
                当您在 **智能对话** 中下达指令时，AI 会自动读取当前状态为“已开启”的技能描述。如果您的指令属于该技能处理的范畴（例如周报整理或文档阅读），AI 将在后台调用底层规则引擎，自动为您注入定制的参数。
              </p>
            </div>
          </div>
        )}

      </div>
    </motion.div>
  );
};
