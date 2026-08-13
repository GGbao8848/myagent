// Keycloak PKCE 登录/登出/token 管理
// 依赖 .env 注入（Vite 环境变量）
const KC_ISSUER = import.meta.env.VITE_KEYCLOAK_ISSUER || "http://127.0.0.1:6543/realms/br-platform";
const KC_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || "br-agent";

const TOKEN_KEY = "kc_access_token";
const REFRESH_KEY = "kc_refresh_token";
const ID_TOKEN_KEY = "kc_id_token";

export { TOKEN_KEY, REFRESH_KEY, ID_TOKEN_KEY };

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

// 纯 JS SHA-256：HTTP + LAN IP 环境下 crypto.subtle 不可用（Web Crypto 仅 HTTPS/localhost 提供），作为登录 PKCE 的 fallback
function sha256Bytes(data: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const bitLen = data.length * 8;
  const bitLenHi = Math.floor(bitLen / 4294967296);
  const bitLenLo = bitLen >>> 0;
  const paddedLen = (((data.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, bitLenHi, false);
  dv.setUint32(paddedLen - 4, bitLenLo, false);

  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const w = new Int32Array(64);
  let [h0, h1, h2, h3, h4, h5, h6, h7] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  for (let i = 0; i < paddedLen; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15]!;
      const w2 = w[t - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t]! + w[t]!) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => odv.setUint32(i * 4, v, false));
  return out;
}

async function sha256(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain);
  const hash = crypto?.subtle ? new Uint8Array(await crypto.subtle.digest("SHA-256", data)) : sha256Bytes(data);
  return btoa(String.fromCharCode(...hash))
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
  syncTokenToDesktop();
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
    syncTokenToDesktop();
    return true;
  } catch {
    return false;
  }
}

/** 清除本地 token（不跳转） */
export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(ID_TOKEN_KEY);
  // 通知桌面客户端主进程断开本机能力网关（纯浏览器忽略）
  window.desktopAPI?.syncToken("", "").catch(() => {});
}

/** 会话过期事件：App 监听后切回登录页 */
export const SESSION_EXPIRED_EVENT = "br-agent:session-expired";

/** 登录过期：清 token 并通知 App 跳回登录页 */
export function handleSessionExpired(): void {
  clearTokens();
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

/** 登出：调 Keycloak logout + 清理本地 */
export function logout(): void {
  const idToken = localStorage.getItem(ID_TOKEN_KEY);
  clearTokens();
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

/** 桌面客户端桥：把 access_token 同步给 Electron 主进程（供本机能力网关连后端 WS）；纯浏览器无 window.desktopAPI 则跳过 */
function syncTokenToDesktop(): void {
  const { access } = getTokens();
  if (window.desktopAPI?.syncToken) {
    window.desktopAPI.syncToken(access ?? "", "").catch(() => {});
  }
}
