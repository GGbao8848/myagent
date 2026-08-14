// 环境配置加载

export interface AppConfig {
  openaiApiKey: string;
  openaiBaseUrl: string;
  defaultModel: string;
  databaseUrl: string;
  keycloakIssuer: string;
  keycloakClientId: string;
  port: number;
  dataDir: string;
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
  };
}
