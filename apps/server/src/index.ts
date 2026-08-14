// 服务入口：Fastify 启动
// 先加载 .env（config.ts 读取 process.env）
import { config as loadDotenv } from "dotenv";
loadDotenv();
import Fastify from "fastify";
import cors from "@fastify/cors";
import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { requireAuth, verifyToken } from "./auth/jwt.js";
import { handleKeycloakLogout, registerSseLogoutClient } from "./auth/kc-logout.js";
import { registerSessionRoutes } from "./modules/sessions/sessions.routes.js";
import { registerSkillRoutes } from "./modules/skills/skills.routes.js";
import { registerMcpRoutes } from "./modules/mcp/mcp.routes.js";
import { registerLlmRoutes } from "./modules/llm/llm.routes.js";
import { registerClientGatewayRoutes } from "./modules/client-gateway/ws-routes.js";
const config = loadConfig();
// 确保数据目录存在
mkdirSync(config.dataDir, { recursive: true });

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, credentials: true });

// Keycloak back-channel logout 用 application/x-www-form-urlencoded 发 logout_token，
// fastify 核心不支持该 content-type，需注册解析器（否则 415）。
// 注意：value 必须用 decodeURIComponent 解码（只解 %XX，不把 `+` 当空格）——
// 不能用 URLSearchParams（它把 `+` 解码成空格，破坏 JWT）；也不能不解码
// （Keycloak 会把 JWT 里的 +/= 百分号编码为 %2B/%3D，不解导致签名解码失败）。
app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "buffer" }, (_req, body, done) => {
  try {
    const raw = body.toString();
    const parsed: Record<string, string> = {};
    for (const pair of raw.split("&")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const key = pair.slice(0, eq).trim();
      if (!key) continue;
      let value = pair.slice(eq + 1).trim();
      try {
        value = decodeURIComponent(value);
      } catch {
        /* 非 %XX 编码原样保留 */
      }
      parsed[key] = value;
    }
    done(null, parsed);
  } catch (e) {
    done(e as Error, undefined);
  }
});

// 健康检查（无需认证）
app.get("/api/health", async () => ({ ok: true, service: "br-agent", time: new Date().toISOString() }));

// Keycloak back-channel logout 回调（无需认证：logout token 由本服务验签）
app.post("/api/auth/kc-logout", async (request, reply) => {
  try {
    // OIDC back-channel logout 的 token 在 body 的 logout_token 字段
    const token = (request.body as { logout_token?: string } | undefined)?.logout_token;
    await handleKeycloakLogout(token);
    reply.code(200).send({ ok: true });
  } catch (e) {
    app.log.warn(`[kc-logout] 校验失败: ${(e as Error).message}`);
    reply.code(401).send({ error: "无效的 logout token" });
  }
});

// 单点登出（SLO）：Web 前端 SSE 订阅端——Keycloak back-channel logout 触发时，
// 服务端向所有订阅者推送 logout（Web 无法用 front-channel iframe 清 localStorage，
// 因为 br-agent 配置了 back-channel 后 Keycloak 会跳过 front-channel）。
app.get("/api/sse/logout", async (request, reply) => {
  const token = new URL(request.url, `http://${request.headers.host ?? "localhost"}`).searchParams.get("token");
  if (!token) {
    reply.code(401).send({ error: "缺少 token" });
    return;
  }
  try {
    await verifyToken(token);
  } catch {
    reply.code(401).send({ error: "token 无效" });
    return;
  }
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  reply.raw.write("retry: 5000\n\n");
  const unregister = registerSseLogoutClient(reply.raw);
  request.raw.on("close", unregister);
});

// 需要认证的路由（health / kc-logout 放行；sse/logout 自带 token 校验）
app.addHook("onRequest", async (request, reply) => {
  const path = request.url.split("?")[0];
  if (path === "/api/health" || path === "/api/auth/kc-logout" || path === "/api/sse/logout") return;
  await requireAuth(request, reply);
});
registerSessionRoutes(app);
registerSkillRoutes(app);
registerMcpRoutes(app);
registerLlmRoutes(app);
await registerClientGatewayRoutes(app);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`BR-Agent server listening on http://localhost:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
