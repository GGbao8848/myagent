// API 请求封装：自动携带 Bearer token
import { getAccessToken, refreshToken } from "./auth";

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  let token = getAccessToken();

  if (!token) {
    // 无 token，尝试刷新
    const ok = await refreshToken();
    if (ok) token = getAccessToken();
  }

  if (!token) {
    throw new Error("未登录或登录已过期");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  const resp = await fetch(url, { ...options, headers });

  // token 过期 → 尝试刷新后重试一次
  if (resp.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) {
      const newToken = getAccessToken()!;
      const retryHeaders = new Headers(options.headers || {});
      retryHeaders.set("Authorization", `Bearer ${newToken}`);
      return fetch(url, { ...options, headers: retryHeaders });
    }
    // 刷新失败 → 跳转登录
    window.location.href = "/";
    throw new Error("登录已过期，请重新登录");
  }

  return resp;
}
