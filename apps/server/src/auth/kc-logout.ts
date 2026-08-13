// Keycloak back-channel logout 校验与单点登出（SLO）广播：
// - 验签 logout token（由 Keycloak 在任意端登出时 POST 到本服务）
// - 广播登出给所有已连接客户端：桌面端（WS）与 Web 前端（SSE）
import type { ServerResponse } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { loadConfig } from "../config.js";
import { broadcastLogout } from "../modules/client-gateway/registry.js";

// back-channel logout token 的 events 类型（OIDC 规范）
const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksIssuer = "";

function getJwks(issuer: string) {
  if (!jwks || jwksIssuer !== issuer) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
    jwksIssuer = issuer;
  }
  return jwks;
}

/** 验签 logout token（由 Keycloak 在 back-channel logout 时 POST 到本服务） */
export async function verifyLogoutToken(token: string): Promise<void> {
  const config = loadConfig();
  const { payload } = await jwtVerify(token, getJwks(config.keycloakIssuer), {
    issuer: config.keycloakIssuer,
    audience: config.keycloakClientId,
    algorithms: ["RS256"],
  });
  // 必须是 back-channel logout 事件，且带 sub 或 sid（OIDC back-channel logout token 要求）
  const events = payload.events as Record<string, unknown> | undefined;
  if (!events || typeof events !== "object" || !(BACKCHANNEL_LOGOUT_EVENT in events)) {
    throw new Error("不是 back-channel logout token");
  }
  if (!payload.sub && !payload.sid) {
    throw new Error("logout token 缺少 sub/sid");
  }
}

// ── Web 前端 SSE 订阅（SLO 广播用）──
// 注：br-agent 配置了 back-channel logout 后，Keycloak 会跳过 front-channel iframe，
// 所以 Web 前端不能用 /slo-logout 页面清 token，改为经 SSE 由服务端广播登出。
const sseClients = new Set<ServerResponse>();

export function registerSseLogoutClient(res: ServerResponse): () => void {
  sseClients.add(res);
  return () => sseClients.delete(res);
}

export function notifySseLogout(): void {
  for (const res of sseClients) {
    try {
      res.write("data: logout\n\n");
    } catch {
      sseClients.delete(res);
    }
  }
}

/** 处理 Keycloak back-channel logout 通知：广播登出给桌面客户端（WS）与 Web 前端（SSE） */
export async function handleKeycloakLogout(token: string | undefined): Promise<void> {
  if (!token) throw new Error("缺少 logout token");
  await verifyLogoutToken(token);
  broadcastLogout(); // 桌面客户端
  notifySseLogout(); // Web 前端
}
