// 环境配置加载
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export interface AppConfig {
  openaiApiKey: string;
  openaiBaseUrl: string;
  defaultModel: string;
  databaseUrl: string;
  keycloakIssuer: string;
  keycloakClientId: string;
  port: number;
  dataDir: string;
  maxConcurrentGenerations: number; // 全局对话并发上限
  pythonPath: string; // 共享 Python 解释器（skill/脚本执行用），默认项目 .venv
  uvPath: string; // uv 可执行文件（run_pip 装依赖用），默认 ~/.local/bin/uv
}

export function loadConfig(): AppConfig {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? "brsys-2026",
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "http://10.10.10.146:8000/v1",
    defaultModel: process.env.DEFAULT_MODEL ?? "/models/Qwen3.5-27B-FP8",
    databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:123456@localhost:5432/br_agent",
    keycloakIssuer: process.env.KEYCLOAK_ISSUER ?? "http://127.0.0.1:6543/realms/br-platform",
    keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? "br-agent",
    port: Number(process.env.PORT ?? 9004),
    dataDir: process.env.DATA_DIR ?? "data",
    maxConcurrentGenerations: Number(process.env.MAX_CONCURRENT_GENERATIONS ?? 700),
    pythonPath: process.env.PYTHON_PATH ?? join(here, "..", ".venv", "Scripts", "python.exe"),
    uvPath: process.env.UV_PATH ?? join(process.env.USERPROFILE ?? "", ".local", "bin", "uv.exe"),
  };
}
