import React from "react";
import { motion } from "motion/react";
import { 
  Link, Info, Plus, Eye, RefreshCw, Trash2, Wrench, Sparkles, Check, Copy 
} from "lucide-react";
import { MCPServer } from "../types";

interface McpViewProps {
  showTips: boolean;
  toggleShowTips: () => void;
  setShowAddServerModal: (show: boolean) => void;
  mcpServers: MCPServer[];
  handleToggleMcpStatus: (id: string) => void;
  expandedMcpServers: { [serverId: string]: boolean };
  setExpandedMcpServers: React.Dispatch<React.SetStateAction<{ [serverId: string]: boolean }>>;
  handleTestMcpServer: (id: string, name: string) => void;
  handleDeleteMcpServer: (id: string) => void;
  handleCopyParamName: (paramName: string, toolName?: string, e?: React.MouseEvent) => void;
  copiedParamKey: string | null;
}

export const McpView: React.FC<McpViewProps> = ({
  showTips,
  toggleShowTips,
  setShowAddServerModal,
  mcpServers,
  handleToggleMcpStatus,
  expandedMcpServers,
  setExpandedMcpServers,
  handleTestMcpServer,
  handleDeleteMcpServer,
  handleCopyParamName,
  copiedParamKey,
}) => {
  return (
    <motion.div 
      key="mcp-view"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.15 }}
      className="p-6 overflow-y-auto h-full"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Page header banner */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-display font-semibold text-slate-900 flex items-center gap-2">
              <Link className="w-5 h-5 text-indigo-500 shrink-0" />
              <span>MCP 协议服务器连通面板</span>
            </h2>
            {showTips && (
              <p className="text-xs text-slate-500 mt-1 leading-relaxed animate-fade-in">
                通过 Model Context Protocol (MCP) 让 AI 穿透沙箱，安全调用本地或第三方应用数据与系统接口，实现强大的真自动化办公。
              </p>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={toggleShowTips}
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                showTips 
                  ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100" 
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Info className="w-3.5 h-3.5" />
              <span>{showTips ? "隐藏说明" : "显示说明"}</span>
            </button>

            <button 
              onClick={() => setShowAddServerModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg shadow-sm transition-colors shrink-0 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加 MCP 服务器</span>
            </button>
          </div>
        </div>

        {/* Server Row List */}
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-visible shadow-2xs">
          {mcpServers.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              目前未注册任何 MCP 协议服务，请点击右上方按钮导入。
            </div>
          ) : (
            mcpServers.map((server) => {
              const isConnected = server.status === "connected";
              const isConnecting = server.status === "connecting";
              
              return (
                <div 
                  key={server.id}
                  className="flex flex-col p-4 gap-3.5 hover:bg-slate-50/50 transition-colors first:rounded-t-xl last:rounded-b-xl"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Name & Connection Point */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-display font-semibold text-xs text-slate-900 truncate">{server.name}</h3>
                        <span className="px-1.5 py-0.2 text-[9px] font-mono rounded bg-slate-100 text-slate-600 border border-slate-150 uppercase shrink-0 whitespace-nowrap">
                          {server.type}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-slate-400 mt-1 truncate" title={server.urlOrCommand}>
                        {server.urlOrCommand}
                      </p>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-3 shrink-0 justify-between md:justify-end flex-wrap sm:flex-nowrap">
                      {/* Switch & Status */}
                      <div className="flex items-center gap-3 bg-slate-100/60 rounded-lg p-1 px-2 border border-slate-100 shrink-0 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isConnected ? "bg-emerald-500 animate-pulse" :
                            isConnecting ? "bg-amber-500 animate-spin" :
                            "bg-slate-300"
                          }`}></span>
                          <span className="font-medium text-slate-600 whitespace-nowrap">
                            {isConnected ? "已联通" : isConnecting ? "正在连接" : "离线"}
                          </span>
                        </div>

                        <span className="h-3 w-px bg-slate-200 shrink-0"></span>

                        <button 
                          onClick={() => handleToggleMcpStatus(server.id)}
                          title={isConnected ? "关闭连接" : "开启连接"}
                          className="relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden bg-slate-200"
                          style={{ backgroundColor: isConnected ? "#0f172a" : "#e2e8f0" }}
                        >
                          <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                            isConnected ? "translate-x-3" : "translate-x-0"
                          }`} />
                        </button>
                      </div>

                      <button 
                        onClick={() => {
                          setExpandedMcpServers(prev => ({
                            ...prev,
                            [server.id]: !prev[server.id]
                          }));
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-[10px] font-medium transition-colors shrink-0 whitespace-nowrap cursor-pointer ${
                          expandedMcpServers[server.id]
                            ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800 shadow-3xs"
                            : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200"
                        }`}
                      >
                        <Eye className="w-3 h-3 shrink-0" />
                        <span>{expandedMcpServers[server.id] ? "隐藏工具" : "展示工具"}</span>
                      </button>

                      <button 
                        onClick={() => handleTestMcpServer(server.id, server.name)}
                        disabled={isConnecting}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-[10px] font-medium transition-colors shrink-0 whitespace-nowrap cursor-pointer ${
                          isConnected 
                            ? "bg-white hover:bg-slate-50 text-slate-700 border-slate-200" 
                            : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-150"
                        }`}
                      >
                        <RefreshCw className={`w-3 h-3 shrink-0 ${isConnecting ? 'animate-spin' : ''}`} />
                        <span>{isConnected ? "测试联通" : "连通测试"}</span>
                      </button>

                      <button 
                        onClick={() => handleDeleteMcpServer(server.id)}
                        title="注销此服务器"
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      </button>
                    </div>
                  </div>

                  {/* Collapsible Tools List Section */}
                  {expandedMcpServers[server.id] && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-2.5 pt-3 border-t border-slate-100 overflow-visible"
                    >
                      <div className="text-[10px] font-bold text-slate-400 uppercase mb-2 tracking-wider flex items-center gap-1">
                        <Wrench className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>注册接口工具集 ({server.tools?.length || 0})</span>
                      </div>
                      {(!server.tools || server.tools.length === 0) ? (
                        <p className="text-[10px] text-slate-400 italic">暂无可用工具列表</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 overflow-visible py-1">
                          {server.tools.map((tool, index) => {
                            const isRightSide = index >= Math.ceil(server.tools.length / 2);
                            
                            const schema = tool.inputSchema || (tool as any).input_schema || (tool as any).schema || (tool as any).parameters;
                            let properties: Record<string, any> | null = null;
                            let requiredFields: string[] = [];
                            
                            if (schema) {
                              if (schema.properties && typeof schema.properties === "object") {
                                properties = schema.properties;
                              } else if (typeof schema === "object" && !Array.isArray(schema)) {
                                const schemaKeywords = ["type", "required", "description", "properties", "definitions", "$schema"];
                                const keys = Object.keys(schema);
                                const hasOnlyKeywords = keys.length > 0 && keys.every(k => schemaKeywords.includes(k));
                                if (!hasOnlyKeywords) {
                                  properties = schema;
                                }
                              }
                              if (Array.isArray(schema.required)) {
                                requiredFields = schema.required;
                              }
                            }
                            if (!properties && typeof (tool as any).properties === "object") {
                              properties = (tool as any).properties;
                            }
                            if (requiredFields.length === 0 && Array.isArray((tool as any).required)) {
                              requiredFields = (tool as any).required;
                            }
                            
                            const hasParameters = properties && Object.keys(properties).length > 0;

                            return (
                              <div 
                                key={tool.name}
                                className="group relative inline-flex cursor-help items-center px-2 py-0.5 rounded bg-slate-50 hover:bg-indigo-50 text-[10px] font-mono text-slate-600 hover:text-indigo-700 border border-slate-200/60 hover:border-indigo-200/80 transition-all shadow-3xs"
                              >
                                <span>{tool.name}</span>
                                
                                <div className={`absolute bottom-full ${isRightSide ? 'right-0' : 'left-0'} mb-2 hidden group-hover:block w-80 p-3.5 bg-slate-900/95 text-white text-[11px] rounded-xl shadow-xl z-50 pointer-events-auto text-left leading-relaxed font-sans backdrop-blur-xs border border-white/10 after:content-[''] after:absolute after:top-full after:left-0 after:right-0 after:h-2`}>
                                  <div className="font-semibold text-indigo-400 font-mono text-xs border-b border-white/10 pb-1.5 mb-1.5 flex items-center justify-between gap-1.5">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <Wrench className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                      <span className="truncate">{tool.name}</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={(e) => handleCopyParamName(tool.name, tool.name, e)}
                                      className="text-[10px] text-indigo-300 hover:text-white bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-400/30 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer shrink-0 font-sans"
                                      title="复制工具名称"
                                    >
                                      {copiedParamKey === `${tool.name}:${tool.name}` ? (
                                        <>
                                          <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                                          <span className="text-emerald-300 font-medium text-[9px]">已复制</span>
                                        </>
                                      ) : (
                                        <>
                                          <Copy className="w-2.5 h-2.5 shrink-0" />
                                          <span className="text-[9px]">复制工具名</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                  <div className="text-slate-200 text-[10.5px] font-sans leading-normal">
                                    {tool.description || "无可用详细描述。"}
                                  </div>

                                  {hasParameters && properties && (
                                    <div className="border-t border-white/10 pt-2.5 mt-2.5">
                                      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                                        <span>参数详情 / Parameters Schema</span>
                                        <span className="text-[9px] text-indigo-300/80 font-normal normal-case flex items-center gap-1">
                                          <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                                          <span>点击参数名复制</span>
                                        </span>
                                      </div>
                                      <div className="max-h-48 overflow-y-auto pr-0.5 custom-scrollbar">
                                        <div className="grid grid-cols-[minmax(80px,_1.2fr)_42px_1.8fr] gap-x-2 gap-y-2 text-[10px] items-start border-t border-white/5 pt-2">
                                          <div className="text-[9px] font-medium text-slate-500 uppercase font-sans tracking-wide">参数 / Name</div>
                                          <div className="text-[9px] font-medium text-slate-500 uppercase font-sans tracking-wide">类型 / Type</div>
                                          <div className="text-[9px] font-medium text-slate-500 uppercase font-sans tracking-wide">说明 / Desc</div>
                                          
                                          {Object.entries(properties).map(([propName, propDetails]: [string, any]) => {
                                            const isRequired = requiredFields.includes(propName);
                                            const paramKey = `${tool.name}:${propName}`;
                                            const isCopied = copiedParamKey === paramKey;

                                            return (
                                              <React.Fragment key={propName}>
                                                <div className="font-mono font-medium leading-snug break-all">
                                                  <button
                                                    type="button"
                                                    onClick={(e) => handleCopyParamName(propName, tool.name, e)}
                                                    className={`group/param flex items-center gap-1 text-left rounded px-1 py-0.5 -ml-1 border transition-all cursor-pointer ${
                                                      isCopied 
                                                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/50" 
                                                        : "text-indigo-300 hover:text-white hover:bg-indigo-500/20 border-transparent hover:border-indigo-400/30"
                                                    }`}
                                                    title={`点击一键复制参数名 "${propName}" 到剪贴板`}
                                                  >
                                                    <span className="underline decoration-indigo-400/40 underline-offset-2 group-hover/param:decoration-white">{propName}</span>
                                                    {isRequired && <span className="text-rose-400 font-sans text-[10px]" title="必填">*</span>}
                                                    
                                                    {isCopied ? (
                                                      <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                                                    ) : (
                                                      <Copy className="w-2.5 h-2.5 text-indigo-300/70 opacity-0 group-hover/param:opacity-100 transition-opacity shrink-0" />
                                                    )}
                                                  </button>
                                                </div>
                                                <div className="font-mono text-[9px] text-slate-400 break-all leading-snug pt-0.5">
                                                  {(propDetails && typeof propDetails === "object" ? propDetails.type : typeof propDetails) || "any"}
                                                </div>
                                                <div className="text-slate-200 font-sans text-[9.5px] leading-snug break-words pt-0.5">
                                                  {(propDetails && typeof propDetails === "object" ? propDetails.description : String(propDetails)) || <span className="text-slate-500 italic">无</span>}
                                                </div>
                                              </React.Fragment>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                  <div className={`absolute top-full ${isRightSide ? 'right-4' : 'left-4'} border-4 border-transparent border-t-slate-900/95`} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              );
            })
          )}
        </div>

      </div>
    </motion.div>
  );
};
