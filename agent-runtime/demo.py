"""演示：模拟一个 Agent 通过 MCP 连接 AgentRuntime，完成一次真实任务。

任务：让 Agent 在 workspace 里生成一个脚本并执行、列出文件、读回内容。
"""
import json
import urllib.request

BASE = "http://127.0.0.1:18544/mcp"


def rpc(session_id, method, params=None, req_id=1):
    body = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        body["params"] = params
    req = urllib.request.Request(
        BASE,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Mcp-Session-Id": session_id,
        },
    )
    with urllib.request.urlopen(req) as resp:
        raw = resp.read().decode()
    # 提取 SSE data 里的 JSON（可能多行 data）
    result = None
    for line in raw.splitlines():
        if line.startswith("data: "):
            payload = json.loads(line[6:])
            if "result" in payload:
                result = payload["result"]
    return result


def get_session():
    body = {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "demo", "version": "1.0"},
        },
    }
    req = urllib.request.Request(
        BASE,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
    )
    with urllib.request.urlopen(req) as resp:
        sid = resp.headers["Mcp-Session-Id"]
    rpc(sid, "notifications/initialized", {}, 0)
    return sid


def call_tool(sid, name, args, req_id):
    r = rpc(sid, "tools/call", {"name": name, "arguments": args}, req_id)
    text = r["content"][0]["text"]
    return text


sid = get_session()

print("========== ① Agent 写一个脚本到 workspace ==========")
script = "import sys\nprint('hello from agent-runtime, python', sys.version.split()[0])\n"
print(call_tool(sid, "local_write_file", {"path": "demo.py", "content": script}, 10))

print("\n========== ② Agent 执行这个脚本 ==========")
print(call_tool(sid, "local_exec", {"command": "python demo.py", "cwd": "."}, 11))

print("\n========== ③ Agent 列出 workspace 内容 ==========")
print(call_tool(sid, "local_list_files", {"path": "."}, 12))

print("\n========== ④ Agent 读回文件内容 ==========")
print(repr(call_tool(sid, "local_read_file", {"path": "demo.py"}, 13)))

print("\n========== ⑤ 越界操作被安全拦截 ==========")
print(call_tool(sid, "local_exec", {"command": "del /q demo.py", "cwd": "."}, 14))
