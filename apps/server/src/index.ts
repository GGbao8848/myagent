// 服务入口：Fastify 启动
import Fastify from "fastify";
import cors from "@fastify/cors";
import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { requireAuth } from "./auth/jwt.js";
import { registerSessionRoutes } from "./modules/sessions/sessions.routes.js";
import { registerChatRoutes } from "./modules/chat/chat.routes.js";
import { registerSkillRoutes } from "./modules/skills/skills.routes.js";
import { registerMcpRoutes } from "./modules/mcp/mcp.routes.js";

const config = loadConfig();
// 确保数据目录存在
mkdirSync(config.dataDir, { recursive: true });

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, credentials: true });

// 健康检查（无需认证）
app.get("/api/health", async () => ({ ok: true, service: "br-agent", time: new Date().toISOString() }));

// 需要认证的路由（health 放行）
app.addHook("onRequest", async (request, reply) => {
  const path = request.url.split("?")[0];
  if (path === "/api/health") return;
  await requireAuth(request, reply);
});
registerSessionRoutes(app);
registerChatRoutes(app);
registerSkillRoutes(app);
registerMcpRoutes(app);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`BR-Agent server listening on http://localhost:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
