// Keycloak JWT 校验中间件：校验 access_token，提取 preferred_username
import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { loadConfig } from "../config.js";

// 注意：不能在此处缓存 loadConfig()——ESM 会在 index.ts 的 dotenv 加载前求值本模块，
// 缓存的 issuer 将是 .env 未加载时的默认值。改为运行时读取。
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksIssuer = "";

function getJwks(issuer: string) {
  if (!jwks || jwksIssuer !== issuer) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
    jwksIssuer = issuer;
  }
  return jwks;
}

export interface AuthUser {
  username: string;
  sub: string;
  isAdmin: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "未授权：缺少 Bearer token" });
    return;
  }
  const token = header.slice(7);
  try {
    const config = loadConfig();
    const { payload } = await jwtVerify(token, getJwks(config.keycloakIssuer), {
      issuer: config.keycloakIssuer,
    });
    const username = (payload.preferred_username as string) ?? (payload.sub as string);
    const roles = (payload.realm_access as { roles?: string[] } | undefined)?.roles ?? [];
    request.authUser = { username, sub: payload.sub as string, isAdmin: roles.includes("admin") };
  } catch {
    reply.code(401).send({ error: "未授权：token 无效或已过期" });
  }
}
