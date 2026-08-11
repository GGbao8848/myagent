# 局域网访问部署指南

> 适用场景：BR-Agent 前端（9005）+ 后端（9004）+ Keycloak（6543）默认只服务本机。把整套服务开放给局域网内其他主机访问的完整流程、验证步骤与实际踩坑记录。
>
> 服务器 WLAN IP：`10.1.20.132`

## 目录

- [结论速览](#结论速览)
- [完整流程](#完整流程)
- [坑点清单](#坑点清单)
- [验证清单](#验证清单)
- [注意事项](#注意事项)

## 结论速览

要让其他主机能访问 + 能登录，共 5 个环节缺一不可：

| 环节 | 现状（已改） |
|---|---|
| 后端 Fastify 监听 | `0.0.0.0:9004`（原本就是） |
| 前端 vite preview 监听 | `0.0.0.0:9005`（原本就是） |
| Keycloak 监听 | `0.0.0.0:6543`（原来只监听 `127.0.0.1`） |
| 登录链路 issuer 统一 | 前后端都指向 `10.1.20.132` |
| 防火墙 | 放行入站 9004/9005 |

---

## 完整流程

### 1. Keycloak 监听所有网卡

Keycloak 26 用 `kc.bat start-dev` 启动时**默认只绑定回环地址 `127.0.0.1`**，外部主机无法访问登录页。

修改启动脚本 `D:\keycloak-26.7.0\start_keycloak_hidden.vbs`：

```vbs
ws.Run "cmd /c ""...\kc.bat start-dev --http-port=6543 --http-host=0.0.0.0 1>...\keycloak-startup.log 2>&1""", 0, False
```

停旧进程重启（`taskkill //PID <pid> //T //F`，先确认 `start_keycloak.bat` 的幂等检查：端口被占则不启动，所以必须先停再启）。

**验证**：
```bash
netstat -ano | grep ":6543" | grep LISTEN   # 期望 0.0.0.0:6543
curl -s -o /dev/null -w "%{http_code}" http://10.1.20.132:6543/   # 期望 302
curl -s http://10.1.20.132:6543/realms/br-platform/.well-known/openid-configuration  # issuer 应为 LAN IP
```

### 2. 前端登录地址指向 LAN IP（编译期注入）

`VITE_KEYCLOAK_ISSUER` 是 **Vite 编译时注入**的环境变量，改完**必须重新 `npm run build`**（不是改完刷新页面就行）。

`apps/web/.env`：
```env
VITE_KEYCLOAK_ISSUER=http://10.1.20.132:6543/realms/br-platform
```

重新构建并确认产物注入：
```bash
cd apps/web && npm run build
grep -l "10.1.20.132" dist/assets/*.js   # 期望命中
grep -c "127.0.0.1:6543" dist/assets/*.js  # 期望 0（无残留）
```

### 3. 纯 JS SHA-256 fallback（关键坑）

**现象**：外部访问 `http://10.1.20.132:9005` 点登录，报 `TypeError: Cannot read properties of undefined (reading 'digest')`。

**原因**：PKCE 需要 `crypto.subtle.digest("SHA-256", ...)` 生成 code_challenge，但 **Web Crypto 只在 secure context（HTTPS 或 localhost）提供**。通过 `http://` + IP 访问时 `crypto.subtle` 是 `undefined`。

**解法**：在 `apps/web/src/auth.ts` 的 `sha256()` 里加纯 JS SHA-256 fallback：
```ts
const hash = crypto?.subtle ? new Uint8Array(await crypto.subtle.digest("SHA-256", data)) : sha256Bytes(data);
```
`sha256Bytes` 是零依赖实现（项目里已内置，验证过与 Node `crypto.createHash("sha256")` 输出一致，含中文/UTF-8 用例）。

### 4. Keycloak client 放行回调白名单

**现象**：登录跳到 Keycloak 后显示 **`We are sorry... Invalid parameter: redirect_uri`（HTTP 400）**。

**原因**：前端用 `window.location.origin + "/callback"` 动态拼回调地址，外部访问时是 `http://10.1.20.132:9005/callback`，不在 client 白名单内。

**解法**：Keycloak Admin REST API 给 `br-agent` client 加 `redirectUris` 和 `webOrigins`：
```
PUT /admin/realms/br-platform/clients/{id}
redirectUris: + http://10.1.20.132:9005/*
webOrigins:   + http://10.1.20.132:9005
```
注意：更新 client 要先 GET 完整对象再 PUT（Keycloak 会替换整个对象，不是增量 patch）。

### 5. 后端 KEYCLOAK_ISSUER 统一为 LAN IP

后端 `apps/server/.env` 的 `KEYCLOAK_ISSUER` 原本是 `127.0.0.1:6543`。**这个值是后端校验 token 的 issuer 基准**，必须与浏览器签发的 token `iss` 一致，否则 `jwtVerify` 报 `unexpected "iss" claim value`。

```env
KEYCLOAK_ISSUER=http://10.1.20.132:6543/realms/br-platform
```

> 服务器本机的 `127.0.0.1:6543` 不需要改——那是本机进程访问 Keycloak 拉公钥用，LAN IP 本机同样可达。

### 6. 修复后端 jwt.ts 的 ESM 缓存坑

**现象**：明明 `.env` 改对了、`dotenv` 也能读到新值、后端也重启了，`/api/sessions` 仍 401。

**根因（本次最隐蔽的坑）**：`apps/server/src/auth/jwt.ts` 模块顶层写了 `const config = loadConfig()`。ESM 中 `import` 语句被提升，`index.ts` 加载 `jwt.ts` 时，模块顶层代码在 `index.ts` 的 `loadDotenv()` **之前**求值——此时 `.env` 还没加载，`config.keycloakIssuer` 被缓存为默认值 `127.0.0.1`。之前能工作是因为默认值恰好等于 `.env` 旧值；一旦 `.env` 改成差异化配置就失效。

**解法**：改为运行时读取，不在模块顶层缓存：
```ts
function getJwks(issuer: string) { /* 按 issuer 参数缓存 */ }
// requireAuth 内：
const config = loadConfig();
await jwtVerify(token, getJwks(config.keycloakIssuer), { issuer: config.keycloakIssuer });
```

### 7. 防火墙放行入站端口

```bash
# 管理员权限（普通 shell 会报"请求的操作需要提升"）
netsh advfirewall firewall add rule name="BR-Agent web 9005" dir=in action=allow protocol=TCP localport=9005
netsh advfirewall firewall add rule name="BR-Agent server 9004" dir=in action=allow protocol=TCP localport=9004
# 验证
netsh advfirewall firewall show rule name="BR-Agent web 9005"
```

---

## 坑点清单

| # | 现象 | 根因 | 解法 |
|---|---|---|---|
| 1 | 外部访问 6543 不通 | Keycloak `start-dev` 默认绑 `127.0.0.1` | 启动加 `--http-host=0.0.0.0` 并重启 |
| 2 | 改了 `.env` 前端没变化 | `VITE_*` 是编译期注入 | 改后必须 `npm run build`，`vite preview` 服务的是 dist |
| 3 | 点登录报 `crypto.subtle` undefined | HTTP + IP 非 secure context，Web Crypto 不可用 | `auth.ts` 加纯 JS SHA-256 fallback |
| 4 | 登录页 `Invalid parameter: redirect_uri`（400） | client 白名单缺 LAN IP 回调 | Admin API 加 `redirectUris`/`webOrigins` |
| 5 | `/api/*` 401 `iss` 不匹配 | 后端 `KEYCLOAK_ISSUER` 仍是 127.0.0.1，与 token iss 不一致 | 后端 `.env` 改为 LAN IP 并重启 |
| 6 | 重启后仍 401（最隐蔽） | `jwt.ts` 模块顶层缓存 `loadConfig()`，ESM 求值先于 dotenv | 改为运行时读取，不缓存 |
| 7 | 外部连不上 | Windows 防火墙拦入站 | netsh 放行 9004/9005（需管理员） |

---

## 验证清单

```bash
# 1. 服务可达
curl -s -o /dev/null -w "%{http_code}" http://10.1.20.132:9005/          # 200
curl -s http://10.1.20.132:9005/api/health                               # {"ok":true,...}（vite 代理转发到 9004）
# 2. Keycloak
curl -s -o /dev/null -w "%{http_code}" http://10.1.20.132:6543/          # 302
# 3. 登录链路（浏览器）
#    http://10.1.20.132:9005 → 登录 → 跳 LAN IP Keycloak → 登录表单（非 400）→ 回 /callback → 进入系统
# 4. 后端 token 校验：拿一个 LAN IP 签发的 access_token
curl -s http://10.1.20.132:9005/api/sessions -H "Authorization: Bearer <token>"   # 200
```

---

## 注意事项

- **本机旧会话需重新登录**：后端 issuer 统一为 LAN IP 后，之前通过 `127.0.0.1` 登录签发的 token `iss` 是 `127.0.0.1`，会被后端拒（401 后前端自动跳登录页）。重新登录一次即可，此后本机和外网统一走 LAN IP。
- **`.env` 不进 git 仓库**：`apps/web/.env`、`apps/server/.env` 都不被 git 跟踪（安全）。部署到新机器需手动创建。
- **`/api` 代理**：外部访问 `http://10.1.20.132:9005/api/*` 时，由 `vite preview` 的 proxy 在服务器进程内转发到 `http://localhost:9004`，外部主机无需直连 9004。
- **Keycloak 外部直连 6543 的防火墙**：浏览器登录时直接访问 Keycloak（LAN IP:6543），所以 6543 也必须对局域网可达。若公司网络策略严格，可考虑改用 Nginx 反代统一入口 + HTTPS，此时还要把前端 `VITE_KEYCLOAK_ISSUER`、client 白名单、后端 issuer 同步指向反代域名。
