# AgentRuntime

运行在员工 Windows 电脑上的**本地 Agent 运行时**：装一次成为开机自启的 Windows 服务，通过 **MCP**（Model Context Protocol）向 AI Agent 暴露受控的本地计算机能力（执行命令、读写文件、浏览目录）。员工无需安装 Python/Node，Agent 只需配置一行 MCP 地址即可调用。

> 本目录已并入 BR-Agent 仓库统一管理。BR-Agent 桌面客户端的本机操作统一经服务器代理到本服务的 `local_exec / local_read_file / local_write_file / local_list_files`（对应客户端侧的 `mcp_local_*`）。联调中的问题与修复见 [docs/agent-mcp-联调排障记录.md](../docs/agent-mcp-联调排障记录.md)。开发启动方式见下文「快速开始（开发）」。

## 最终效果

```
┌─────────────────────────────────────┐
│ 员工 Windows 电脑                     │
│                                     │
│   AgentRuntime Service（开机自启）    │
│    ├─ MCP Server (127.0.0.1:18544)  │
│    ├─ 权限层（目录/命令白名单 + 审计）  │
│    └─ Executor（Shell / 文件 / 进程） │
│                                     │
│   Agent 客户端（Claude/自研/其他）     │
└─────────────────────────────────────┘
```

- **员工侧**：双击 `AgentRuntime-Setup.exe` 安装后什么都不用做，服务自动注册并开机自启。
- **Agent 侧**：在 MCP 配置里加一行地址即可连接，之后 Agent 自动调用本地能力，全程无需员工操作命令行。
- **管理员侧**：只需分发安装包 + 初始配置一次白名单，日常无运维负担。

## 功能（MVP）

| 工具 | 说明 |
|---|---|
| `local_exec` | 执行本地命令（仅限白名单命令），返回退出码 / stdout / stderr |
| `local_read_file` | 读取允许目录内的文本文件 |
| `local_write_file` | 向允许目录内的文件写入文本（覆盖） |
| `local_list_files` | 列出允许目录内的文件与子目录（类型/大小/修改时间） |

一个典型闭环：Agent 收到「帮我修一下 build 脚本报错」→ 自动 `列出目录 → 读文件 → 改文件 → 执行 python build.py` → 返回结果。

## 安全设计

- **只监听 localhost**：默认 `127.0.0.1:18544`，局域网其他机器无法访问；SDK v2 自带 DNS-rebinding 防护。
- **目录白名单**：文件操作只允许在 `allowed_dirs` 内；`..` 与符号链接逃逸会被 realpath 解析后拦截。
- **命令白名单**：`local_exec` 只执行 `allowed_commands` 内的命令，`shlex` 拆分 + `shell=False` 杜绝 shell 注入。
- **审计日志**：每次调用记录时间/工具/参数摘要/结果/耗时，滚动落盘（敏感内容脱敏）。

## 目录结构

```
agent-runtime/
├── pyproject.toml
├── config.example.yaml            # 配置模板（复制为 config.yaml）
├── src/agent_runtime/
│   ├── __main__.py                # 入口
│   ├── server.py                  # MCP Server 组装 + 注册工具
│   ├── config.py                  # 配置加载
│   ├── security/                  # 权限层 + 审计
│   │   ├── path_policy.py
│   │   ├── command_policy.py
│   │   └── audit.py
│   └── tools/                     # 工具实现
│       ├── exec_tool.py
│       └── file_tools.py
├── packaging/                     # 打包脚本
│   ├── entry.py
│   ├── build.ps1                  # PyInstaller 打包
│   ├── install_service.ps1        # NSSM 装服务
│   ├── uninstall_service.ps1      # NSSM 卸服务
│   └── AgentRuntime.iss           # Inno Setup
└── tests/
```

## 快速开始（开发）

```bash
# 1. 创建虚拟环境并安装依赖
uv venv --python 3.11 .venv
uv pip install --python .venv/Scripts/python.exe mcp pyyaml

# 2. 复制配置模板并修改
cp config.example.yaml config.yaml   # Windows: copy config.example.yaml config.yaml

# 3. 启动（默认监听 127.0.0.1:18544）
PYTHONPATH=src .venv/Scripts/python.exe -m agent_runtime
```

用官方 MCP Inspector 调试：

```bash
uvx mcp dev src/agent_runtime/server.py
```

## Agent 如何接入

Agent 无需安装任何 AgentRuntime 组件，只需在其 MCP 客户端配置里加：

```json
{
  "mcpServers": {
    "AgentRuntime": {
      "url": "http://localhost:18544/mcp"
    }
  }
}
```

Claude Desktop / Codex / Cursor 等客户端在 MCP 配置界面填入该 URL 即可。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/配置说明.md](docs/配置说明.md) | config.yaml 全项详解、白名单变更、Python 环境约定、常见坑 |
| [docs/安全设计.md](docs/安全设计.md) | 目录/命令白名单、参数级路径校验、引号处理、可执行文件解析、审计脱敏 |
| [docs/能力与升级路线.md](docs/能力与升级路线.md) | 当前能力盘点（实测）与后续升级路线（P0~P4）+ 代码升级流程 |
| [docs/部署与运维.md](docs/部署与运维.md) | 开发启动、打包、NSSM 装服务、重启、验证、审计日志解读、常见问题 |
| [docs/agent-mcp-联调排障记录.md](../../docs/agent-mcp-联调排障记录.md) | 与 BR-Agent 联调遇到的问题与修复实战（仓库根 docs/） |

## 打包与部署（生产）

### 方式一：手动部署（开发机到目标机）

1. 打包：
   ```powershell
   powershell -ExecutionPolicy Bypass -File packaging\build.ps1
   ```
   产物在 `dist\AgentRuntime\`。
2. 下载 [NSSM](https://nssm.cc/download)，把 `nssm.exe` 与 `dist\AgentRuntime\` 一并复制到 `C:\Program Files\AgentRuntime\`。
3. 准备 `C:\ProgramData\AgentRuntime\config.yaml`（参照 `config.example.yaml`）。
4. 以管理员运行：
   ```powershell
   powershell -ExecutionPolicy Bypass -File packaging\install_service.ps1 `
     -InstallDir "C:\Program Files\AgentRuntime" -ConfigPath "C:\ProgramData\AgentRuntime\config.yaml"
   ```

### 方式二：Inno Setup 安装包（正式分发）

1. 先执行 `build.ps1`，并把 `nssm.exe` 放到 `packaging\`。
2. 用 [Inno Setup](https://jrsoftware.org/isinfo.php) 打开 `packaging\AgentRuntime.iss` 编译。
3. 得到 `packaging\output\AgentRuntime-Setup.exe`，发给员工双击安装即可（自动注册服务、开机自启、卸载清理）。

## 配置说明

见 `config.example.yaml`，关键项：

- `server.host/port/path`：监听地址，默认 `127.0.0.1:18544/mcp`。
- `security.allowed_dirs`：Agent 可访问的目录白名单（绝对路径）。
- `security.allowed_commands`：允许执行的命令名白名单。
- `security.exec_timeout_seconds`：单次命令超时。
- `logging.log_dir`：审计日志目录。

配置查找顺序：环境变量 `AGENTRUNTIME_CONFIG` → 当前目录 `config.yaml` → `%PROGRAMDATA%\AgentRuntime\config.yaml`。

## 参考项目

- [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP)（6.7k⭐）— Windows MCP 工具集的事实标准
- [dddabtc/winremote-mcp](https://github.com/dddabtc/winremote-mcp) — 安全本地执行（tier 分级 / IP allowlist）的参考实现
- [javillegasna/filesystem](https://github.com/javillegasna/filesystem) — 目录白名单 + symlink 校验的最小实现
- [Hesccc/shell-mcp-server](https://github.com/Hesccc/shell-mcp-server) — 命令白名单 + shlex 防注入

## 运行测试

```bash
PYTHONPATH=src .venv/Scripts/python.exe -m pytest tests/ -v
```
