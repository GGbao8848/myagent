# Agent × MCP 联调排障记录（客户端本机执行链路）

> 适用场景：桌面客户端调用 MCP 本机工具（local_exec / local_read_file / local_write_file / local_list_files）执行 Python 脚本时出现「卡死 / 反复重试 / 报错不收敛 / 连不上 / 会话失效」等问题。
>
> 更新：2026-08-13

## 目录

- [背景与架构](#背景与架构)
- [问题 1：引号保留导致 `python -c` 静默空执行（根因）](#问题1引号保留导致-python--c-静默空执行根因)
- [问题 2：相对可执行文件被解析到错误目录（根因）](#问题2相对可执行文件被解析到错误目录根因)
- [问题 3：MCP 重启后 `Session not found` 不自动恢复](#问题3mcp-重启后-session-not-found-不自动恢复)
- [问题 4：客户端工具与 MCP 工具功能重复](#问题4客户端工具与-mcp-工具功能重复)
- [问题 5：agent 工具循环无护栏，卡死整轮生成](#问题5agent-工具循环无护栏卡死整轮生成)
- [问题 6：命令白名单只校验命令名，参数可越权](#问题6命令白名单只校验命令名参数可越权)
- [问题 7：PostgreSQL 服务停止导致登录 500](#问题7postgresql-服务停止导致登录-500)
- [修复后的工具清单与执行约定](#修复后的工具清单与执行约定)
- [测试用例（全量通过）](#测试用例全量通过)
- [运维操作手册](#运维操作手册)

## 背景与架构

桌面客户端 agent 的本机操作统一经服务器代理到 **agent-runtime MCP 服务**（`127.0.0.1:18544`，运行在员工电脑上）：

```
客户端 agent ── HTTP ──> BR-Agent server(9004) ── MCP ──> agent-runtime(18544) ──> 本机执行
                              │  mcp.service.ts 缓存 MCP 连接
                              └── 白名单校验 + 审计日志(workspace/logs/audit.log)
```

工具名统一为 `mcp_local_*`（客户端经服务器转发），能力矩阵：

| 工具 | 作用 | 安全约束 |
|---|---|---|
| `mcp_local_exec` | 执行白名单命令 | 命令白名单 + 参数级路径校验 + 超时 |
| `mcp_local_write_file` | 写入文件 | 目录白名单 |
| `mcp_local_read_file` | 读取文件 | 目录白名单 |
| `mcp_local_list_files` | 列目录 | 目录白名单 |

---

## 问题 1：引号保留导致 `python -c` 静默空执行（根因）

**现象**：agent 发出 `python -c "import matplotlib; print(matplotlib.__version__)"` 探测命令，MCP 返回 `exit_code: 0` 但 **stdout 为空**，agent 永远读不到环境信息 → 误判"库未安装" → 反复装包重试 20+ 次，把整轮生成耗尽。

**根因**：`command_policy.py` 用 `shlex.split(command, posix=False)` 拆分命令，**Windows 下 posix=False 会保留引号字符**：

```
'python -c "import sys; print(sys.executable)"'
→ ['python', '-c', '"import sys; print(sys.executable)"']   ← 引号还在
→ python -c 收到带引号的字符串 → 当作字符串字面量执行 → 静默成功、零输出
```

**修复**（`command_policy.py`）：拆分后剥掉参数首尾的成对引号，`python -c` 才能真正执行代码；带空格的路径参数由 `subprocess` 自行加回引号。

**验证**：`.venv\Scripts\python.exe -c "import sys; print(sys.executable)"` 输出真实路径。

---

## 问题 2：相对可执行文件被解析到错误目录（根因）

**现象**：`import matplotlib` 报 `ModuleNotFoundError`，但 matplotlib 明确预装在 `workspace\.venv` 里。agent 以为装包失败，重复 `uv pip install`。

**根因**：Windows 下 `subprocess.run`（底层 `CreateProcess`）查找可执行文件用的是**父进程（MCP 服务）的 cwd + PATH**，而不是传给 `subprocess.run(cwd=...)` 的目录。命令 `.venv\Scripts\python.exe` 是相对路径 → 被解析到 **`agent-runtime\.venv`**（MCP 自己的 venv，只装了 mcp/pyyaml），而不是 `workspace\.venv`。**预装库从未被用上**；此前"成功"是 `--break-system-packages` 恰好把包装进了系统 python。

**修复**（`exec_tool.py`）：`argv[0]` 为相对路径且 `workdir/argv[0]` 存在时，绝对化到 workdir：

```python
if not os.path.isabs(argv[0]):
    resolved_exe = os.path.join(workdir, argv[0])
    if os.path.exists(resolved_exe):
        argv = [resolved_exe, *argv[1:]]
```

**验证**：`sys.executable` 输出 `E:\br\MCP\agent-runtime\workspace\.venv\Scripts\python.exe`，matplotlib/pandas/Pillow 全部可 import。

---

## 问题 3：MCP 重启后 `Session not found` 不自动恢复

**现象**：agent 的所有 MCP 工具调用连续报 `{"code":-32600,"message":"Session not found"}`，agent 重试也无效，最终只落库半句话。

**根因**：BR-Agent server 的 `mcp.service.ts` 用 `mcpClients` 缓存 `MultiServerMCPClient`（含 streamable-http 的 session id）。**MCP 服务重启后旧 session 全部失效**，但缓存只在配置变更时重建（`invalidateMcpClient`），没有连接失效自动重连。

**修复**（`mcp.service.ts`）：
- 缓存加 **120s TTL**，到期自动重建连接（兜底 MCP 重启后自愈）
- `callMcpTool` 调用失败且为连接类错误（`Session not found` / `POSTing to endpoint` / `ECONNRESET` / `fetch failed` 等）→ 失效缓存 → 重建连接 → **重试一次**

---

## 问题 4：客户端工具与 MCP 工具功能重复

**现象**：客户端 agent 同时注入两组本机工具：本地直连（`read_file`/`list_dir`/`write_file`/`delete_file`/`run_command`，Electron 进程内直接执行，**无白名单无审计**）与 `mcp_local_*`（有白名单 + 审计）。同一件事两条路，agent 行为不一致。

**修复**（`apps/desktop/src/main/agent/tool-registry.ts` + `engine.ts`）：**删除全部本地直连工具**，本机操作统一收敛到 `mcp_local_*`。工具链现在只有：

```
skill_*（本地技能脚本） + mcp_*（MCP 工具，含 mcp_local_*）
```

---

## 问题 5：agent 工具循环无护栏，卡死整轮生成

**现象**：某轮对话 agent 连调 14+ 次工具反复重试不收敛，用户手动点「停止」后，SSE 请求**一直挂起不返回**（服务端日志无 `request completed`），且该轮没有任何 assistant 消息落库。

**根因**：`agent/runner.ts` 的 ReAct 循环：单轮模型流式调用无超时、整轮无总时长上限；`AbortController.abort()` 后流可能不抛错，循环提前 break 但请求不结束，catch 分支因 `signal.aborted` 跳过落库。

**修复**（`agent/runner.ts`，server 与 desktop 两端同步）：
- 单轮模型流式调用超时 **2 分钟**，整轮生成总时长上限 **5 分钟**
- 内部 `AbortController` 跟随外部 signal（用户停止时同步中止流），清理定时器无泄漏
- 超时抛明确错误（`模型响应超时（超过 120s），已中止生成`），走 catch 落库，区别于用户主动停止（静默 break）

---

## 问题 6：命令白名单只校验命令名，参数可越权

**现象/风险**：命令白名单只校验命令名，不校验参数。`python -c "shutil.copy2('x', r'E:\br\BR-Agent\data\test.py')"` 这类命令可携带任意路径参数，**绕过目录白名单读写任意位置**。

**修复**（`exec_tool.py`，与问题 1/2 同文件）：**参数级路径校验**——命令参数中出现的绝对路径必须落在 `allowed_dirs` 内：

- 覆盖普通参数、`--python`/`-o` 等 flag 的值、`python -c`/`node -e` 代码块内嵌的字符串路径（含 `r'...'` 原始字符串）
- 越权一律抛 `PermissionError`，返回"拒绝访问：命令参数中的路径 …超出允许目录范围"

> 注意：本项在引号修复前拦截的是"静默空执行"的假越权；引号修复后 `-c` 真正执行，本项才是真实兜底。

---

## 问题 7：PostgreSQL 服务停止导致登录 500

**现象**：客户端登录后报 `Error invoking remote method 'api:request': ... Invalid prisma.llmProvider.findMany() ... Can't reach database server at localhost:5432`。

**根因**：`postgresql-x64-18` 服务停止（VBS 自启失效），5432 无监听。

**修复**：管理员权限启动服务：

```bash
powershell -Command "Start-Process net -ArgumentList 'start','postgresql-x64-18' -Verb RunAs -Wait"
```

---

## 修复后的工具清单与执行约定

agent-runtime `local_exec` 的 Python 环境约定（已写入工具描述，agent 会读到）：

1. **执行脚本用工作区 venv 解释器**：`.venv\Scripts\python.exe`（相对 cwd），已预装 matplotlib / numpy / pandas / openpyxl / requests / pillow / seaborn
2. **缺库用 uv 装到 venv**：`uv pip install --python .venv\Scripts\python.exe <包名>`
3. **禁止**系统 `python -m pip install`（uv 托管环境报 externally-managed-environment）
4. **禁止** `uv run` 执行脚本（无项目文件时自动下载 pyinstaller 创建临时环境，污染本机）

白名单（`config.yaml`）：`python` `node` `npm` `git` `pip` `uv` `dir` `ls` `echo` `type` `where` `mkdir`；超时 120s。

---

## 测试用例（全量通过）

经服务器 `callMcpTool` 实测（12/12 通过）：

| 分组 | 用例 | 结果 |
|---|---|---|
| 越权拦截 | `python E:/tmp/xxx.py` 被拒；`python -c` 内嵌越权路径被拒；`local_read_file` 越权被拒 | ✅ |
| 引号+解释器 | `-c` 输出 workspace venv 路径；matplotlib 3.11.1 可 import；pandas/Pillow 可 import；中文无乱码 | ✅ |
| 依赖闭环 | `uv pip install --python .venv\Scripts\python.exe seaborn` → import 成功 | ✅ |
| 写→执行→读 | write → run → list 全链路 | ✅ |
| 白名单 | `uv --version` 放行 | ✅ |

---

## 运维操作手册

### 重启 MCP 服务（agent-runtime）

```powershell
# 找 PID：netstat -ano | findstr 18544
taskkill /PID <pid> /F
# 脱离会话启动（普通后台任务会被回收，exit 127）
Start-Process -FilePath 'E:\br\MCP\agent-runtime\.venv\Scripts\python.exe' `
  -ArgumentList '-m','agent_runtime' `
  -WorkingDirectory 'E:\br\MCP\agent-runtime' -WindowStyle Hidden
# 验证：netstat -ano | findstr 18544；curl POST /mcp initialize 握手
```

> 生产环境建议装成服务自启：`packaging/install_service.ps1`（NSSM）。

### 重启 BR-Agent server

```bash
pm2 restart br-agent-server
# 新代码生效后 MCP 连接缓存自动重建；MCP 重启后无需手动清缓存（TTL 120s 自愈）
```

### 重新打包桌面客户端

```bash
cd apps/desktop && npm run build   # 产物 release/BR-Agent Setup 0.1.0.exe
```

### 验证入口

- MCP 审计日志：`E:\br\MCP\agent-runtime\logs\audit.log`（每次工具调用：工具/参数/耗时/结果）
- BR-Agent 服务日志：`logs/server-out.log` / `logs/server-error.log`
- 会话中间过程：数据库 `Message.timeline`（thinking/tool_call/tool_result 全记录）
