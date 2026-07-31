import express from "express";
import path from "path";
import http from "http";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 9003;

app.use(express.json({ limit: "10mb" }));

// ── /api 转发到 backend（FastAPI deepagents 内核）──
const BACKEND_URL = process.env.AGENT_BACKEND_URL || "http://127.0.0.1:7890";
console.log(`[server] /api 转发到 ${BACKEND_URL}`);

app.use("/api", (req, res) => {
  const backend = new URL(BACKEND_URL);
  const headers: Record<string, string> = { ...(req.headers as any) };
  headers["host"] = backend.host;
  headers["connection"] = "keep-alive";

  const proxyReq = http.request(
    {
      host: backend.hostname,
      port: backend.port || 80,
      method: req.method,
      path: req.originalUrl, // 保留完整 /api 前缀
      headers,
    },
    (proxyRes) => {
      // 透传响应头
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    console.error("[server] 转发失败:", err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: "Agent 后端不可达" });
    }
  });

  // 转发请求体
  req.pipe(proxyReq);
});

// Vite & Static file serving setup for production and dev
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Assistant server running on port ${PORT}`);
  });
}

startServer();
