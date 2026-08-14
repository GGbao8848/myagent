// 主进程 REST API 客户端：带 Bearer token + 401 自动刷新重试（仿 apps/web/src/api.ts）
import { resolveKeycloak } from "./auth.js";

export class ApiClient {
  private baseUrl = "";
  private access = "";
  private refresh = "";
  private onTokenExpired: (() => void) | null = null;

  setServerUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  setTokens(access: string, refresh: string): void {
    this.access = access;
    this.refresh = refresh;
  }

  /** 当前服务器地址（SLO WebSocket 连接用） */
  get serverUrl(): string {
    return this.baseUrl;
  }

  /** 当前 access token（SLO WebSocket 连接用） */
  get accessToken(): string {
    return this.access;
  }

  setOnTokenExpired(cb: () => void): void {
    this.onTokenExpired = cb;
  }

  hasToken(): boolean {
    return !!this.access;
  }

  get username(): string {
    if (!this.access) return "";
    try {
      const payload = JSON.parse(Buffer.from(this.access.split(".")[1]!, "base64url").toString());
      return payload.preferred_username || payload.sub || "";
    } catch {
      return "";
    }
  }

  get isAdmin(): boolean {
    if (!this.access) return false;
    try {
      const payload = JSON.parse(Buffer.from(this.access.split(".")[1]!, "base64url").toString());
      const roles = (payload.realm_access as { roles?: string[] } | undefined)?.roles ?? [];
      return roles.includes("admin");
    } catch {
      return false;
    }
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.access) headers.Authorization = `Bearer ${this.access}`;
    // 请求超时护栏：服务器不可达/挂起时 60s 中止，避免整轮对话挂死
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (resp.status === 401 && retry && this.refresh) {
      const ok = await this.refreshAccessToken();
      if (ok) return this.request<T>(method, path, body, false);
      this.onTokenExpired?.();
      throw new Error("登录已过期，请重新登录");
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(text || `请求失败（${resp.status}）`);
    }
    return resp.json() as Promise<T>;
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refresh) return false;
    try {
      const kc = resolveKeycloak(this.baseUrl);
      const resp = await fetch(`${kc.issuer}/protocol/openid-connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: kc.clientId,
          refresh_token: this.refresh,
        }),
      });
      if (!resp.ok) return false;
      const data = (await resp.json()) as { access_token?: string; refresh_token?: string };
      if (!data.access_token) return false;
      this.access = data.access_token;
      if (data.refresh_token) this.refresh = data.refresh_token;
      return true;
    } catch {
      return false;
    }
  }
}

export const apiClient = new ApiClient();
