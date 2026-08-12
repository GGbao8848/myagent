// 极简 stdio MCP server（离线可用）：用于验证 BR-Agent 桌面客户端「本机 MCP」链路。
// 协议：JSON-RPC 2.0 over stdio，LSP 风格 Content-Length framing（与 @modelcontextprotocol/sdk 一致）。
// 用法：node echo-mcp.js
// 配置本机 MCP 时：command=node，args=[<本文件绝对路径>]
"use strict";

const readline = require("readline");

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let buffer = "";

rl.on("line", (line) => {
  buffer += line + "\n";
  // 处理 Content-Length framing
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const m = /Content-Length:\s*(\d+)/i.exec(buffer.slice(0, headerEnd));
    if (!m) break;
    const len = parseInt(m[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length - bodyStart < len) break;
    const body = buffer.slice(bodyStart, bodyStart + len);
    buffer = buffer.slice(bodyStart + len);
    try {
      handle(JSON.parse(body));
    } catch (e) {
      // 忽略非法消息
    }
  }
});

function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "br-agent-echo", version: "1.0.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "echo_text",
            description: "回显输入文本（本机 stdio MCP 链路验证用）",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string", description: "要回显的文本" } },
              required: ["text"],
            },
          },
        ],
      },
    });
    return;
  }
  if (method === "tools/call") {
    const { name, arguments: args } = params;
    const text = args && args.text !== undefined ? String(args.text) : "";
    send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: `echo 收到：${text}` }] },
    });
    return;
  }
  send({ jsonrpc: "2.0", id, result: null });
}
