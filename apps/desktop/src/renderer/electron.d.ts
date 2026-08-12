export interface ElectronAPI {
  login(): Promise<{ ok: boolean; error?: string }>;
  logout(): Promise<{ ok: boolean }>;
  authStatus(): Promise<{ ok: boolean; username: string; isAdmin: boolean }>;
  apiRequest<T = unknown>(payload: { method?: string; path?: string; body?: unknown }): Promise<T>;
  getSettings(): Promise<{ serverUrl?: string }>;
  saveSettings(settings: unknown): Promise<{ ok: boolean; error?: string }>;
  chat(sessionId: string, content: string, securityMode?: string): Promise<{ ok: boolean; error?: string }>;
  stop(sessionId: string): Promise<{ ok: boolean }>;
  onAgentEvent(callback: (data: unknown) => void): () => void;
  onTokenExpired(callback: () => void): () => void;
  onToolConfirm(callback: (data: unknown) => void): () => void;
  toolConfirmResponse(callId: string, approved: boolean): Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
