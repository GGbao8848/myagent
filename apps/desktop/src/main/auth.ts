// Keycloak PKCE 登录（Electron）：跳转系统浏览器登录，客户端本机常驻 loopback 回调端口接收 code。
// 前提：Keycloak 管理台给 client "br-agent" 的 Valid redirect URIs 添加 http://127.0.0.1:30088/callback
import { shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

export interface KeycloakConfig {
  issuer: string;
  clientId: string;
}

/** 从服务器地址推断 Keycloak（同主机 :6543 / realm br-platform） */
export function resolveKeycloak(serverUrl: string): KeycloakConfig {
  const u = new URL(serverUrl);
  const protocol = u.protocol === "https:" ? "https" : "http";
  return {
    issuer: `${protocol}://${u.hostname}:6543/realms/br-platform`,
    clientId: "br-agent",
  };
}

export const CALLBACK_PORT = 30088;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface Tokens {
  access: string;
  refresh: string;
  idToken?: string; // 登出时拼 end_session 的 id_token_hint
}

function exchangeCode(kc: KeycloakConfig, code: string, verifier: string, redirectUri: string): Promise<Tokens> {
  return fetch(`${kc.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: kc.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  }).then(async (resp) => {
    if (!resp.ok) throw new Error(`换取 token 失败（${resp.status}）`);
    const data = (await resp.json()) as { access_token?: string; refresh_token?: string; id_token?: string };
    if (!data.access_token) throw new Error("换取 token 失败：缺少 access_token");
    return { access: data.access_token, refresh: data.refresh_token ?? "", idToken: data.id_token ?? "" };
  });
}

// ── 常驻回调 server：app 生命周期内始终监听 30088，登录时复用，避免端口冲突 ──
interface PendingLogin {
  kc: KeycloakConfig;
  verifier: string;
  redirectUri: string;
  resolve: (t: Tokens) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

let callbackServer: Server | null = null;
let pendingLogin: PendingLogin | null = null;

function ensureCallbackServer(): void {
  if (callbackServer) return;
  callbackServer = createServer((req, res) => {
    const u = new URL(req.url ?? "/", `http://127.0.0.1:${CALLBACK_PORT}`);
    const code = u.searchParams.get("code");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><meta charset='utf-8'><h3>✅ 登录成功，请返回 BR-Agent 客户端</h3>");
    if (code && pendingLogin) {
      const p = pendingLogin;
      pendingLogin = null;
      clearTimeout(p.timer);
      exchangeCode(p.kc, code, p.verifier, p.redirectUri).then(p.resolve, p.reject);
    }
  });
  callbackServer.on("error", (e) => {
    const p = pendingLogin;
    pendingLogin = null;
    if (p) {
      clearTimeout(p.timer);
      p.reject(new Error(`回调端口监听失败：${(e as Error).message}`));
    }
  });
  // 常驻：监听失败也保留 server 引用（error 已处理）
  try {
    callbackServer.listen(CALLBACK_PORT, "127.0.0.1", () => {
      // eslint-disable-next-line no-console
      console.error(`[auth] 回调端口就绪 http://127.0.0.1:${CALLBACK_PORT}/callback`);
    });
  } catch {
    /* listen 错误由 error 事件处理 */
  }
}

/** 系统浏览器登录：打开 Keycloak，登录后回环到常驻回调端口换 token */
export async function loginWithKeycloak(serverUrl: string): Promise<Tokens> {
  const kc = resolveKeycloak(serverUrl);
  const redirectUri = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const authUrl = `${kc.issuer}/protocol/openid-connect/auth?${new URLSearchParams({
    client_id: kc.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "openid profile email",
  })}`;

  ensureCallbackServer();

  return new Promise<Tokens>((resolve, reject) => {
    if (pendingLogin) {
      clearTimeout(pendingLogin.timer);
      pendingLogin.reject(new Error("已有登录流程进行中，请完成或重试"));
    }
    const timer = setTimeout(() => {
      if (pendingLogin) {
        pendingLogin = null;
        reject(new Error("登录超时，请重试"));
      }
    }, 180_000);
    pendingLogin = { kc, verifier, redirectUri, resolve, reject, timer };
    void shell.openExternal(authUrl).catch((e) => {
      if (pendingLogin) {
        pendingLogin = null;
        clearTimeout(timer);
        reject(e as Error);
      }
    });
  });
}

/** 单点登出：打开 Keycloak end_session（带 id_token_hint + 回跳），触发 web/aimemory 的 front-channel logout */
export function logoutFromKeycloak(serverUrl: string, idToken?: string): void {
  const kc = resolveKeycloak(serverUrl);
  const params = new URLSearchParams({
    client_id: kc.clientId,
    post_logout_redirect_uri: `http://127.0.0.1:${CALLBACK_PORT}/callback`,
  });
  if (idToken) params.set("id_token_hint", idToken);
  const url = `${kc.issuer}/protocol/openid-connect/logout?${params}`;
  void shell.openExternal(url);
}
