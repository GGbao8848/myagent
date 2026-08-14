// 服务器地址解析（CS 模式）：用户填后端地址（如 http://192.168.1.100:9004），
// 返回 { web: 后端 API 地址, ws: 同主机 SLO WebSocket 地址 }。默认端口 9004。
export function parseServerUrl(raw: string): { web: string; ws: string } {
  let s = (raw ?? "").trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  const protocol = u.protocol === "https:" ? "https" : "http";
  const port = u.port || (u.protocol === "https:" ? "443" : "9004");
  const web = `${protocol}://${u.hostname}:${port}`;
  const ws = `${protocol === "https" ? "wss" : "ws"}://${u.hostname}:9004`;
  return { web, ws };
}
