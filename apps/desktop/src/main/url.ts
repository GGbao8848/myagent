// 服务器地址解析：用户填 web 地址（如 http://192.168.1.100:9005），
// 推导出 web 加载地址与后端 WS 地址（同主机 :9004）。
export function parseServerUrl(raw: string): { web: string; ws: string } {
  let s = (raw ?? "").trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  const protocol = u.protocol === "https:" ? "https" : "http";
  const webPort = u.port || (u.protocol === "https:" ? "443" : "9005");
  const web = `${protocol}://${u.hostname}:${webPort}`;
  const ws = `${protocol === "https" ? "wss" : "ws"}://${u.hostname}:9004`;
  return { web, ws };
}
