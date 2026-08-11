# 服务启动排查（无法登录 / 服务不可达）

> 适用场景：BR-Agent 打不开 / 无法登录 / 接口全部超时。本文档记录「登录链路依赖哪些服务、如何判断哪个没起来、怎么拉起」的排查方法与本次实战记录。
>
> 更新：2026-08-11

## 目录

- [登录链路依赖](#登录链路依赖)
- [排查步骤](#排查步骤)
- [本次实战：服务未自启](#本次实战服务未自启)
- [验证清单](#验证清单)
- [预防措施](#预防措施)

## 登录链路依赖

登录链路共 4 个服务，**缺一个都登不进去**。其中前后端由 PM2 自启，PostgreSQL 与 Keycloak 由启动文件夹的 VBS 自启（易失效）。

| 服务 | 端口 | 启动方式 | 挂了的表现 |
|---|---|---|---|
| 前端 web | 9005 | PM2（br-agent-web） | 页面打不开 |
| 后端 server | 9004 | PM2（br-agent-server） | 登录后接口全 401/500；`/api/health` 无响应 |
| PostgreSQL | 5432 | 启动文件夹 VBS → `pg_ctl` | 后端连库失败，接口报错 |
| Keycloak | 6543 | 启动文件夹 VBS → `start_keycloak.bat` | **登录页跳转即失败（最常见的"无法登录"原因）** |

## 排查步骤

### 1. 先看端口，一次定位

```bash
# 四个关键端口是否在监听
netstat -ano | grep -E ":(9004|9005|6543|5432)" | grep LISTEN
```

- 缺失的端口 = 对应服务没起来，直接到第 3 步拉起它。
- 若 9004/9005 缺失，先查 PM2：

```bash
pm2 status    # br-agent-server / br-agent-web 是否 online
```

### 2. 判断"登录失败"是哪个环节

| 现象 | 判断 |
|---|---|
| 页面能开、点登录跳不过去 / 卡在登录 | **Keycloak 6543 没起来**（最常见） |
| 能到 Keycloak 登录页、登录后接口全挂 | 后端 9004 或 PostgreSQL 5432 没起来 |
| 页面直接打不开 | 前端 9005 没起来 |

### 3. 拉起缺失的服务

**PostgreSQL**（幂等，已在跑不会重复）：
```bash
"D:/PostgreSQL/18/bin/pg_ctl.exe" -D "D:/PostgreSQL/18/data" -l "D:/PostgreSQL/18/data/pglog.txt" start
```

**Keycloak**（静默无窗口；脚本自带 6543 端口占用检查，已在跑则跳过）：
```bash
cmd //c "D:\\keycloak-26.7.0\\start_keycloak.bat"
```
Keycloak 是 Java 应用，启动需几十秒；可用以下命令等端口就绪后再验证：
```bash
until netstat -ano | grep ":6543" | grep LISTEN >/dev/null; do sleep 2; done; echo "Keycloak 6543 已监听"
```

**前端 / 后端**（PM2 挂了时）：
```bash
pm2 restart br-agent-server
pm2 restart br-agent-web
```

## 本次实战：服务未自启

- **症状**：agent 无法登录，页面能开。
- **排查**：`netstat` 显示 9004/9005 在监听，**6543 与 5432 缺失** → PostgreSQL 与 Keycloak 都没起来。
- **根因**：这两个服务依赖系统启动文件夹的 VBS 自启（`start_postgres_hidden.vbs` / `start_keycloak_hidden.vbs`），本次开机后未生效（PM2 只管前后端）。
- **修复**：手动 `pg_ctl` 拉起 PostgreSQL，运行 `start_keycloak.bat` 拉起 Keycloak，等待 6543 就绪后刷新页面即可重新登录。

## 验证清单

```bash
# 端口
netstat -ano | grep -E ":(9004|9005|6543|5432)" | grep LISTEN   # 4 个都应命中

# 服务响应
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:6543/   # Keycloak → 302（跳登录）
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9004/api/health   # 后端 → 200
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9005/   # 前端 → 200

# 浏览器：打开 9005 → 登录 → 跳 Keycloak 登录页 → 回系统
```

## 预防措施

- **自启失效排查**：检查启动文件夹（`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`）里的 VBS 是否还在；可手动运行一次确认能拉起。
- **更稳方案**：把 PostgreSQL 与 Keycloak 注册为 Windows 服务（`sc create` / NSSM），替代启动文件夹 VBS，开机不依赖登录会话。
- **一键检查脚本**：可将「端口检查 + 缺失即拉起 + 验证」写成脚本（参考上面对应命令），服务器重启后跑一次即可快速恢复。
