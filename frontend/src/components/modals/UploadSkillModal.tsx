import React from "react";
import { motion } from "motion/react";
import { X, Upload, Check } from "lucide-react";

interface UploadSkillModalProps {
  showUploadSkillModal: boolean;
  setShowUploadSkillModal: (show: boolean) => void;
  isDraggingSkill: boolean;
  setIsDraggingSkill: (dragging: boolean) => void;
  uploadProgress: number | null;
  setUploadProgress: (prog: number | null) => void;
  uploadSuccessMsg: string | null;
  setUploadSuccessMsg: (msg: string | null) => void;
  handleUploadSkill: (filename: string) => void;
}

export const UploadSkillModal: React.FC<UploadSkillModalProps> = ({
  showUploadSkillModal,
  setShowUploadSkillModal,
  isDraggingSkill,
  setIsDraggingSkill,
  uploadProgress,
  setUploadProgress,
  uploadSuccessMsg,
  setUploadSuccessMsg,
  handleUploadSkill,
}) => {
  if (!showUploadSkillModal) return null;

  return (
    <motion.div 
      key="modal-upload-skill"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 15 }}
        className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl max-w-md w-full relative"
      >
        <div className="flex justify-between items-center border-b border-slate-50 pb-3">
          <h3 className="font-display font-semibold text-sm text-slate-900">上传企业自定义技能包</h3>
          <button 
            onClick={() => {
              setShowUploadSkillModal(false);
              setUploadProgress(null);
              setUploadSuccessMsg(null);
            }} 
            className="p-1 hover:bg-slate-100 rounded text-slate-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-500 leading-normal">
            请上传包含 `.json` 定义和规则流程的技能安装包（支持 ZIP/JSON 格式）。导入后 AI 助手将直接学习并掌握该技能的处理规则。
          </p>

          {/* Drag and Drop Zone */}
          <div 
            onDragOver={(e) => { e.preventDefault(); setIsDraggingSkill(true); }}
            onDragLeave={() => setIsDraggingSkill(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingSkill(false);
              const files = e.dataTransfer.files;
              if (files && files.length > 0) {
                handleUploadSkill(files[0].name);
              }
            }}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".zip,.json";
              input.onchange = (e: any) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  handleUploadSkill(files[0].name);
                }
              };
              input.click();
            }}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              isDraggingSkill 
                ? "border-indigo-500 bg-indigo-50/30" 
                : "border-slate-200 hover:border-slate-400 bg-slate-50/50"
            }`}
          >
            <Upload className="w-7 h-7 mx-auto text-slate-400 mb-2.5" />
            <span className="block text-xs font-semibold text-slate-800">拖拽文件到此处，或点击浏览本地</span>
            <span className="block text-[10px] text-slate-400 mt-1">支持扩展名：.zip, .json (大小限制 10MB 内)</span>
          </div>

          {/* Upload feedback progress bar */}
          {uploadProgress !== null && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                <span>解析技能配置文件中...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                <div className="bg-slate-950 h-full transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          {/* Upload Success Banner */}
          {uploadSuccessMsg && (
            <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-lg border border-emerald-150 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{uploadSuccessMsg}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-50 text-xs">
            <button 
              onClick={() => {
                setShowUploadSkillModal(false);
                setUploadProgress(null);
                setUploadSuccessMsg(null);
              }}
              className="px-4 py-1.5 border border-slate-200 rounded-lg font-medium hover:bg-slate-50 cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
