import React, { useState } from "react";
import { motion } from "motion/react";
import { X, Copy, Check, Terminal, FileCode, Server, Zap, Radio, Database } from "lucide-react";

interface ApiDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ApiDocsModal: React.FC<ApiDocsModalProps> = ({ isOpen, onClose }) => {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"stream" | "rest" | "python" | "env">("stream");

  if (!isOpen) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(label);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const fastApiCode = `import json
import asyncio
from typing import AsyncGenerator
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="Agentic Office FastAPI Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    session_id: str | None = None
    messages: list[dict]
    profile: dict | None = None
    memories: list[dict] | None = None
    skills: list[dict] | None = None
    mcp_servers: list[dict] | None = None
    model_id: str | None = "model_gemini"

# 1. SSE Stream Endpoint (流式 Token 逐字返回)
@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    async def event_generator() -> AsyncGenerator[str, None]:
        # 思维链推送
        yield f"data: {json.dumps({'type': 'thinking', 'content': '正在解析需求与匹配记忆画像...'})}\\n\\n"
        await asyncio.sleep(0.3)

        # 工具调用提示 (选填)
        if req.mcp_servers:
            yield f"data: {json.dumps({'type': 'tool_call', 'tool': 'mcp_db.query', 'args': '{\"limit\":10}', 'status': 'running'})}\\n\\n"
            await asyncio.sleep(0.4)

        # Token 逐字流式返回
        reply_text = f"尊敬的 {req.profile.get('name', '用户') if req.profile else '用户'}：\\n\\n已成功连接到 FastAPI 智能体后端！"
        for char in reply_text:
            yield f"data: {json.dumps({'type': 'token', 'delta': char})}\\n\\n"
            await asyncio.sleep(0.02)

        yield f"data: {json.dumps({'type': 'done', 'message_id': 'msg_finished'})}\\n\\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto"
    >
      <motion.div
        initial={{ scale: 0.96, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 15 }}
        className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden text-xs"
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-sm text-white flex items-center gap-2">
                <span>FastAPI 智能体后端对接指南</span>
                <span className="text-[10px] bg-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded font-mono border border-indigo-400/30">
                  SSE / WebSocket
                </span>
              </h3>
              <p className="text-[11px] text-slate-300 mt-0.5">
                前端适配规范：逐字 Token 返回、思维链推演、MCP 与技能框架接口定义
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-navigation Tabs */}
        <div className="flex items-center gap-1 p-2 bg-slate-100/80 border-b border-slate-200 shrink-0 font-medium text-[11px]">
          <button
            onClick={() => setActiveTab("stream")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === "stream"
                ? "bg-white text-indigo-600 shadow-2xs font-semibold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>1. 流式协议 (SSE/WS)</span>
          </button>

          <button
            onClick={() => setActiveTab("rest")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === "rest"
                ? "bg-white text-indigo-600 shadow-2xs font-semibold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>2. RESTful 数据接口</span>
          </button>

          <button
            onClick={() => setActiveTab("python")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === "python"
                ? "bg-white text-indigo-600 shadow-2xs font-semibold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>3. FastAPI 代码范例</span>
          </button>

          <button
            onClick={() => setActiveTab("env")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === "env"
                ? "bg-white text-indigo-600 shadow-2xs font-semibold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>4. 环境变量配置</span>
          </button>
        </div>

        {/* Modal Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 leading-relaxed text-slate-700">
          {activeTab === "stream" && (
            <div className="space-y-4">
              <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl text-indigo-900 text-xs">
                <strong>核心链路逻辑：</strong>
                <p className="mt-1 text-slate-600">
                  <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-100 font-mono text-indigo-700">
                    用户 -&gt; 前端 -&gt; WebSocket / SSE -&gt; 后端 FastAPI -&gt; Agent -&gt; 大模型 API -&gt; Token 逐字返回
                  </code>
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-indigo-500" />
                  <span>SSE (Server-Sent Events) 请求接口与事件帧说明</span>
                </h4>
                <p className="text-[11px] text-slate-500 mt-1">
                  请求方式：<code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800">POST /api/chat/stream</code>，数据流为每行 <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800">data: {"{...}"}\n\n</code>
                </p>
              </div>

              <div className="bg-slate-900 text-slate-100 rounded-xl p-3.5 font-mono text-[11px] space-y-2 relative">
                <button
                  onClick={() => copyToClipboard(`data: {"type": "thinking", "content": "正在解析用户需求..."}\ndata: {"type": "token", "delta": "根据"}\ndata: {"type": "token", "delta": "查询结果..."}\ndata: {"type": "done", "message_id": "msg_123"}`, "sse_frames")}
                  className="absolute top-2.5 right-2.5 px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-[10px] text-slate-300 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {copiedCode === "sse_frames" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCode === "sse_frames" ? "已复制" : "复制 Event 帧"}</span>
                </button>
                <div className="text-indigo-400 font-bold text-[10px]">// SSE 流式传输事件帧 (Event Types)</div>
                <div><span className="text-amber-400">1. 思维链:</span> data: &#123;"type": "thinking", "content": "正在解析用户需求..."&#125;</div>
                <div><span className="text-sky-400">2. 工具调用:</span> data: &#123;"type": "tool_call", "tool": "mcp_db.query", "status": "running"&#125;</div>
                <div><span className="text-emerald-400">3. Token逐字:</span> data: &#123;"type": "token", "delta": "根据数据..."&#125;</div>
                <div><span className="text-slate-400">4. 结束信号:</span> data: &#123;"type": "done", "message_id": "msg_101"&#125;</div>
              </div>
            </div>
          )}

          {activeTab === "rest" && (
            <div className="space-y-3 text-xs">
              <h4 className="font-semibold text-slate-900">核心 RESTful 后端接口表 (用于持久化)</h4>
              
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="p-2.5">模块</th>
                      <th className="p-2.5">HTTP 方法</th>
                      <th className="p-2.5">接口 Endpoint</th>
                      <th className="p-2.5">说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                    <tr>
                      <td className="p-2.5 font-sans font-medium text-slate-900">会话历史</td>
                      <td className="p-2.5 text-indigo-600 font-bold">GET / POST</td>
                      <td className="p-2.5">/api/sessions</td>
                      <td className="p-2.5 font-sans text-slate-500">拉取/新建用户聊天会话记录</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-sans font-medium text-slate-900">画像记忆</td>
                      <td className="p-2.5 text-indigo-600 font-bold">GET / PUT</td>
                      <td className="p-2.5">/api/user/profile</td>
                      <td className="p-2.5 font-sans text-slate-500">获取/同步用户偏好、部门与语气</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-sans font-medium text-slate-900">技能组件</td>
                      <td className="p-2.5 text-emerald-600 font-bold">POST</td>
                      <td className="p-2.5">/api/skills/upload</td>
                      <td className="p-2.5 font-sans text-slate-500">上传并自动化解析 Skill ZIP 包</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-sans font-medium text-slate-900">MCP 服务</td>
                      <td className="p-2.5 text-indigo-600 font-bold">POST</td>
                      <td className="p-2.5">/api/mcp/test</td>
                      <td className="p-2.5 font-sans text-slate-500">握手测试 MCP 接口并获取 Tools Schema</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-sans font-medium text-slate-900">计划任务</td>
                      <td className="p-2.5 text-indigo-600 font-bold">GET / POST</td>
                      <td className="p-2.5">/api/scheduler/tasks</td>
                      <td className="p-2.5 font-sans text-slate-500">定时任务 Crontab 增加/管理</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "python" && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-800 text-xs">完整 FastAPI 参考代码 (`main.py`)</span>
                <button
                  onClick={() => copyToClipboard(fastApiCode, "python_code")}
                  className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded border border-indigo-200 text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {copiedCode === "python_code" ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCode === "python_code" ? "已复制 Python 代码" : "一键复制 FastAPI 代码"}</span>
                </button>
              </div>

              <div className="bg-slate-900 text-slate-100 p-3.5 rounded-xl font-mono text-[10.5px] leading-relaxed max-h-64 overflow-y-auto custom-scrollbar">
                <pre>{fastApiCode}</pre>
              </div>
            </div>
          )}

          {activeTab === "env" && (
            <div className="space-y-3">
              <h4 className="font-semibold text-slate-900 text-xs">前端 `.env` 环境变量联调设置</h4>
              <p className="text-[11px] text-slate-500">
                在项目根目录下的 <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-800">.env</code> 中配置实际的 FastAPI 服务主页与端口：
              </p>

              <div className="bg-slate-900 text-emerald-400 p-3 rounded-xl font-mono text-[11px] relative">
                <button
                  onClick={() => copyToClipboard(`VITE_API_BASE_URL=http://localhost:8000\nVITE_WS_URL=ws://localhost:8000/ws/chat`, "env_code")}
                  className="absolute top-2 right-2 px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-[10px] text-slate-300 flex items-center gap-1 cursor-pointer"
                >
                  {copiedCode === "env_code" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>复制 .env</span>
                </button>
                <div># FastAPI 后端 HTTP / SSE 地址</div>
                <div>VITE_API_BASE_URL=http://localhost:8000</div>
                <div className="mt-2"># FastAPI 后端 WebSocket 地址</div>
                <div>VITE_WS_URL=ws://localhost:8000/ws/chat</div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 leading-relaxed">
                详细文档说明已完整持久化生成在项目根目录下的 <code className="font-semibold font-mono text-slate-800">/README.md</code> 文件中，方便团队在 GitHub / GitLab 或开发环境中随时阅览！
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-150 bg-slate-50 flex justify-between items-center shrink-0">
          <span className="text-[10px] text-slate-400 font-mono">
            README.md 文件已自动同步生成于项目根目录
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg text-xs cursor-pointer transition-colors shadow-2xs"
          >
            知道了 / 关闭
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
