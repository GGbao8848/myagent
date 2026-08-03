// Keycloak PKCE 登录/登出/token 管理
// 依赖 .env 注入（Vite 环境变量）
const KC_ISSUER = import.meta.env.VITE_KEYCLOAK_ISSUER || "http://127.0.0.1:6543/realms/br-platform";
const KC_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || "br-agent";

const TOKEN_KEY = "kc_access_token";
const REFRESH_KEY = "kc_refresh_token";
const ID_TOKEN_KEY = "kc_id_token";

export function getTokens(): { access: string | null; refresh: string | null } {
  return {
    access: localStorage.getItem(TOKEN_KEY),
    refresh: localStorage.getItem(REFRESH_KEY),
  };
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

function randomString(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 发起 PKCE 授权码登录：生成 verifier/challenge，跳 Keycloak */
export async function login(): Promise<void> {
  const verifier = randomString(64);
  const challenge = await sha256(verifier);
  sessionStorage.setItem("kc_verifier", verifier);
  const params = new URLSearchParams({
    client_id: KC_CLIENT_ID,
    response_type: "code",
    redirect_uri: window.location.origin + "/callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "openid profile email",
  });
  window.location.href = `${KC_ISSUER}/protocol/openid-connect/auth?${params}`;
}

/** 回调页：用 code + verifier 换 token */
export async function handleCallback(code: string): Promise<void> {
  const verifier = sessionStorage.getItem("kc_verifier");
  if (!verifier) throw new Error("缺少 PKCE verifier，请重新登录");
  const resp = await fetch(`${KC_ISSUER}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: KC_CLIENT_ID,
      code,
      redirect_uri: window.location.origin + "/callback",
      code_verifier: verifier,
    }),
  });
  if (!resp.ok) throw new Error("换取 token 失败");
  const data = await resp.json();
  localStorage.setItem(TOKEN_KEY, data.access_token);
  if (data.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token);
  if (data.id_token) localStorage.setItem(ID_TOKEN_KEY, data.id_token);
  sessionStorage.removeItem("kc_verifier");
}

/** 用 refresh token 续期 */
export async function refreshAccessToken(): Promise<boolean> {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return false;
  try {
    const resp = await fetch(`${KC_ISSUER}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: KC_CLIENT_ID,
        refresh_token: refresh,
      }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    localStorage.setItem(TOKEN_KEY, data.access_token);
    if (data.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token);
    if (data.id_token) localStorage.setItem(ID_TOKEN_KEY, data.id_token);
    return true;
  } catch {
    return false;
  }
}

/** 登出：调 Keycloak logout + 清理本地 */
export function logout(): void {
  const idToken = localStorage.getItem(ID_TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(ID_TOKEN_KEY);
  const params = new URLSearchParams({
    client_id: KC_CLIENT_ID,
    post_logout_redirect_uri: window.location.origin,
  });
  if (idToken) params.set("id_token_hint", idToken);
  window.location.href = `${KC_ISSUER}/protocol/openid-connect/logout?${params}`;
}

/** 解码 JWT payload（仅展示用） */
export function getUserName(): string {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return "";
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.preferred_username || payload.sub || "";
  } catch {
    return "";
  }
}

/** 当前用户是否为管理员（JWT realm_access.roles 含 admin） */
export function getIsAdmin(): boolean {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const roles = payload.realm_access?.roles ?? [];
    return roles.includes("admin");
  } catch {
    return false;
  }
}
