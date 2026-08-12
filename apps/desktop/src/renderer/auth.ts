// 渲染进程认证信息缓存（isAdmin 等，从主进程 authStatus 获取）
let cachedIsAdmin = false;

export async function refreshAuthInfo(): Promise<void> {
  try {
    const st = await window.electronAPI!.authStatus();
    cachedIsAdmin = st.isAdmin;
  } catch {
    cachedIsAdmin = false;
  }
}

export function getIsAdmin(): boolean {
  return cachedIsAdmin;
}
