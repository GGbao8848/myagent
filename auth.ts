import { createRemoteJWKSet, jwtVerify } from "jose";
import type { NextFunction, Request, Response } from "express";

// Keycloak realm 的 JWKS 端点
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || "http://127.0.0.1:6543";
const REALM = "br-platform";
const JWKS_URL = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/certs`;

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

export interface AuthUser {
  sub: string;          // Keycloak 用户 ID
  username: string;     // preferred_username
  email?: string;
  roles: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// 校验 Authorization: Bearer <token>，解析当前用户
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "缺少登录凭证，请先登录" });
  }

  const token = header.slice(7);

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${KEYCLOAK_URL}/realms/${REALM}`,
    });

    req.user = {
      sub: payload.sub as string,
      username: (payload.preferred_username as string) || (payload.sub as string),
      email: payload.email as string | undefined,
      roles: (payload.realm_access as any)?.roles || [],
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "登录凭证无效或已过期" });
  }
}
