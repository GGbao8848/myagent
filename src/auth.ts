// Keycloak OIDC PKCE 登录封装
// 使用 br-agent client，跳转 Keycloak 官方登录页

const KEYCLOAK_URL = "http://localhost:6543";
const REALM = "br-platform";
const CLIENT_ID = "br-agent";
const REDIRECT_URI = "http://localhost:9003/callback";

const TOKEN_KEY = "agent_access_token";
const REFRESH_KEY = "agent_refresh_token";
const USER_KEY = "agent_user";

// ── PKCE 工具函数 ──

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

// ── 状态管理 ──

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): any | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

// ── 登录流程 ──

export async function startLogin(): Promise<void> {
  // 生成 PKCE 参数并缓存 verifier（回调时需要）
  const verifier = generateVerifier();
  const challenge = await generateChallenge(verifier);
  sessionStorage.setItem("pkce_verifier", verifier);
  sessionStorage.setItem("pkce_state", generateVerifier()); // 简单随机 state

  const state = sessionStorage.getItem("pkce_state")!;
  const authUrl =
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth?` +
    `client_id=${CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `response_type=code&` +
    `scope=openid profile email&` +
    `state=${state}&` +
    `code_challenge=${challenge}&` +
    `code_challenge_method=S256`;

  window.location.href = authUrl;
}

export async function handleCallback(code: string, state: string): Promise<void> {
  const savedState = sessionStorage.getItem("pkce_state");
  if (savedState && savedState !== state) {
    throw new Error("State 校验失败，登录流程可能被篡改");
  }

  const verifier = sessionStorage.getItem("pkce_verifier");
  if (!verifier) {
    throw new Error("缺少 PKCE verifier，请重新登录");
  }

  // 用 code 换 token
  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("client_id", CLIENT_ID);
  params.append("code", code);
  params.append("redirect_uri", REDIRECT_URI);
  params.append("code_verifier", verifier);

  const resp = await fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`换取 token 失败: ${err}`);
  }

  const data = await resp.json();
  localStorage.setItem(TOKEN_KEY, data.access_token);
  localStorage.setItem(REFRESH_KEY, data.refresh_token);

  // 解析用户信息
  const user = parseUserInfo(data.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));

  // 清理 PKCE 临时状态
  sessionStorage.removeItem("pkce_verifier");
  sessionStorage.removeItem("pkce_state");
}

// ── 解析 JWT ──

export function parseUserInfo(token: string): any {
  const payload = token.split(".")[1];
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const claims = JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/")));

  return {
    sub: claims.sub,
    username: claims.preferred_username,
    email: claims.email,
    name: claims.name,
    roles: claims.realm_access?.roles || [],
  };
}

// ── Token 刷新 ──

export async function refreshToken(): Promise<boolean> {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return false;

  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("client_id", CLIENT_ID);
  params.append("refresh_token", refresh);

  try {
    const resp = await fetch(
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );
    if (!resp.ok) return false;

    const data = await resp.json();
    localStorage.setItem(TOKEN_KEY, data.access_token);
    if (data.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}
