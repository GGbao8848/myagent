# 单点登录 / 单点登出（SSO / SLO）实现说明

> BR-Agent Web（9005）、aimemory Web（18543）、BR-Agent 桌面客户端三者通过同一 Keycloak（10.1.20.132:6543 / realm br-platform）实现浏览器侧 SSO 免密登录与 SLO 单点登出。
> 完整三端矩阵与 aimemory 侧细节见 [aimemory/docs/单点登录设计.md](../../aimemory/docs/单点登录设计.md)（aimemory 独立仓库）。
>
> 更新：2026-08-13

## 本仓库改动清单

### server（apps/server）

| 文件 | 改动 |
|---|---|
| `src/auth/kc-logout.ts` | 新增：验签 Keycloak back-channel logout token（jose+JWKS，issuer/aud=br-agent/backchannel-logout 事件校验）；SSE 订阅注册与广播 |
| `src/index.ts` | 新增 `POST /api/auth/kc-logout`（豁免认证，验签后广播 WS+SSE）；新增 `GET /api/sse/logout?token=`（SSE 订阅，query token 校验）；注册 `application/x-www-form-urlencoded` content-type parser |
| `src/modules/client-gateway/registry.ts` | 新增 `broadcastLogout()`：向所有已连接桌面客户端 WS 广播 `{type:"logout"}` |
| `src/modules/client-gateway/types.ts` | `ServerToClientMessage` 增加 `{type:"logout"}` |

### web（apps/web）

| 文件 | 改动 |
|---|---|
| `src/App.tsx` | 未登录自动跳 Keycloak SSO（sessionStorage 防循环）；SSE 订阅登出（收到 `logout` 清 token 切登录页）；监听 `storage` 事件（front-channel 兜底） |
| `src/auth.ts` | 导出 `TOKEN_KEY` 等常量 |
| `public/slo-logout.html` | front-channel logout 着陆页（清 localStorage token；因配置 back-channel 后 Keycloak 跳过 front-channel，当前为兜底） |

### desktop（apps/desktop）

| 文件 | 改动 |
|---|---|
| `src/main/slo-ws.ts` | 新增：主进程常驻 WS 连 `/api/ws/client?token=`，收 `logout` 清 token-store + 通知渲染层；断线指数退避重连 + 25s ping |
| `src/main/auth.ts` | `Tokens` 增加 `idToken`；新增 `logoutFromKeycloak()`（系统浏览器打开 end_session） |
| `src/main/token-store.ts` | 保存 `idToken`（登出拼 id_token_hint） |
| `src/main/ipc.ts` | 登录保存 idToken + `startSloWatcher()`；登出先清本地再跳 end_session + `stopSloWatcher()` |
| `src/main/index.ts` | 启动恢复 token 时 `startSloWatcher()`；注册登出回调（WS logout → 渲染层 `auth:logout-remote`） |
| `src/main/preload.ts` | 暴露 `onRemoteLogout` |
| `src/renderer/App.tsx` / `electron.d.ts` | 监听 `auth:logout-remote` 切登录页；类型声明 |

## 关键链路（遇坑重点）

```
任一端登出 → Keycloak end_session
  ├─► front-channel iframe → aimemory /slo-logout 清 cookie（18543）
  ├─► back-channel POST logout_token → 9004 /api/auth/kc-logout
  │     （content-type: x-www-form-urlencoded，值 %XX 编码）
  │     → server 验签 → WS 广播（桌面）+ SSE 广播（Web）
  └─► 桌面主动登出：系统浏览器打开 end_session（带 id_token_hint）
```

## 验证记录（实测）

- aimemory 打开 → 免密直达，显示 br0002（与 9005 一致）✅
- 手动加载 `9005/slo-logout` → 9005 立即退出（前端 storage 监听生效）✅
- 真实 back-channel logout（脚本模拟授权码流建立 br-agent 会话 → admin logout）→ server `200` 校验通过 ✅
- 桌面端：`slo-ws.js` 已编译进产物（17:57 构建），WS 端点可达（401=校验拦截正常）；实际登录/登出联动需在装有新版客户端的机器上确认

## 问题与解决办法（详见 aimemory 侧文档）

| 问题 | 根因 | 解决办法 |
|---|---|---|
| 415 Unsupported Media Type | Keycloak back-channel 用 urlencoded，fastify 核心不支持 | 注册 `application/x-www-form-urlencoded` parser |
| Invalid Compact JWS | `URLSearchParams` 把 JWT 的 `+` 解码成空格 | 手动切分 + value 用 `decodeURIComponent` |
| Failed to base64url decode | 解析器不解 `%2B/%3D`（Keycloak 百分号编码了 JWT） | 同上（解码覆盖两种形态） |
| 登录 18543 后开 9005 不自动登录 | 9005 未登录时不自动跳 Keycloak | `App.tsx` 自动跳 SSO（sessionStorage 防循环） |
