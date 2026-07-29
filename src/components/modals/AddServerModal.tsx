import React from "react";
import { motion } from "motion/react";
import { X, Sparkles, AlertTriangle } from "lucide-react";

interface AddServerModalProps {
  showAddServerModal: boolean;
  setShowAddServerModal: (show: boolean) => void;
  mcpJsonText: string;
  setMcpJsonText: (text: string) => void;
  mcpJsonError: string | null;
  setMcpJsonError: (err: string | null) => void;
  handleAddMcpServer: (e: React.FormEvent) => void;
}

export const AddServerModal: React.FC<AddServerModalProps> = ({
  showAddServerModal,
  setShowAddServerModal,
  mcpJsonText,
  setMcpJsonText,
  mcpJsonError,
  setMcpJsonError,
  handleAddMcpServer,
}) => {
  if (!showAddServerModal) return null;

  return (
    <motion.div 
      key="modal-add-mcp-server"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 15 }}
        className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xl max-w-lg w-full relative text-xs"
      >
        <div className="flex justify-between items-center border-b border-slate-150 pb-3">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-900">注册并导入 MCP 服务器 (JSON 格式)</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">请粘入标准的 MCP json 配置信息，支持多台服务器批量导入</p>
          </div>
          <button 
            onClick={() => { setShowAddServerModal(false); setMcpJsonError(null); }} 
            className="p-1 hover:bg-slate-100 rounded text-slate-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleAddMcpServer} className="mt-4 space-y-4 text-xs">
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-[11px] font-semibold text-slate-500">JSON 配置代码</label>
              <button 
                type="button"
                onClick={() => {
                  setMcpJsonText(JSON.stringify({
                    mcpServers: {
                      "my-coffee": {
                        "type": "streamablehttp",
                        "url": "https://gwmcp.lkcoffee.com/order/user/mcp",
                        "headers": {
                          "Authorization": "Bearer <登录后复制Token替换>"
                        }
                      }
                    }
                  }, null, 2));
                  setMcpJsonError(null);
                }}
                className="text-[10px] text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
                <span>插入示例模板</span>
              </button>
            </div>
            
            <textarea 
              rows={8}
              required
              placeholder={`粘贴配置，如:\n{\n  "mcpServers": {\n    "my-server": {\n      "type": "streamablehttp",\n      "url": "https://api.example.com/mcp"\n    }\n  }\n}`}
              value={mcpJsonText}
              onChange={(e) => {
                setMcpJsonText(e.target.value);
                if (mcpJsonError) setMcpJsonError(null);
              }}
              className="w-full border border-slate-200 rounded-lg p-3 text-slate-700 font-mono text-[11px] leading-relaxed focus:outline-hidden focus:ring-1 focus:ring-slate-400 bg-slate-50/50"
            />
          </div>

          {mcpJsonError && (
            <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-lg text-[11px] text-rose-600 flex items-start gap-2 animate-fade-in font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{mcpJsonError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button 
              type="button" 
              onClick={() => { setShowAddServerModal(false); setMcpJsonError(null); }}
              className="px-3.5 py-1.5 border border-slate-200 rounded-lg font-medium hover:bg-slate-50 text-slate-600 cursor-pointer"
            >
              取消
            </button>
            <button 
              type="submit"
              className="px-4 py-1.5 bg-slate-900 hover:bg-slate-850 text-white rounded-lg font-semibold shadow-xs cursor-pointer"
            >
              导入并添加
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};
