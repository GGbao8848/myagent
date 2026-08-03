// Keycloak JWT 校验中间件：校验 access_token，提取 preferred_username
import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { loadConfig } from "../config.js";

const config = loadConfig();
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksIssuer = "";

function getJwks() {
  if (!jwks || jwksIssuer !== config.keycloakIssuer) {
    jwks = createRemoteJWKSet(new URL(`${config.keycloakIssuer}/protocol/openid-connect/certs`));
    jwksIssuer = config.keycloakIssuer;
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
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: config.keycloakIssuer,
    });
    const username = (payload.preferred_username as string) ?? (payload.sub as string);
    const roles = (payload.realm_access as { roles?: string[] } | undefined)?.roles ?? [];
    request.authUser = { username, sub: payload.sub as string, isAdmin: roles.includes("admin") };
  } catch {
    reply.code(401).send({ error: "未授权：token 无效或已过期" });
  }
}
