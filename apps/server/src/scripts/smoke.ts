// 冒烟测试：验证 langchain createAgent + 本地 Qwen3.5 的工具调用与流式
// 运行：npm run smoke
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { tool } from "langchain";
import { z } from "zod";

// dotenv 手动加载
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const envRaw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const model = new ChatOpenAI({
  model: process.env.DEFAULT_MODEL,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0,
});

const getWeather = tool(
  async ({ city }: { city: string }) => `今天 ${city} 的天气是晴，25°C`,
  {
    name: "get_weather",
    description: "查询指定城市的天气",
    schema: z.object({ city: z.string().describe("城市名") }),
  }
);

async function main() {
  console.log("=== 创建 deep agent ===");
  const agent = createAgent({
    model,
    tools: [getWeather],
    systemPrompt: "你是一个简洁的中文助手，用中文回答。",
  });

  console.log("=== 调用 agent（流式 v3）===");
  const run = await agent.streamEvents(
    { messages: [{ role: "user", content: "北京今天天气怎么样？" }] },
    { version: "v3" }
  );

  let textBuf = "";
  let reasoningBuf = "";
  for await (const msg of run.messages) {
    for await (const chunk of msg.text) {
      textBuf += chunk;
    }
    for await (const chunk of msg.reasoning) {
      reasoningBuf += chunk;
    }
  }
  console.log("--- 思考(reasoning) ---");
  console.log(reasoningBuf.substring(0, 2000));
  console.log("--- 正文(text) ---");
  console.log(textBuf.substring(0, 2000));

  for await (const tc of run.toolCalls) {
    console.log("--- 工具调用 ---");
    console.log("name:", tc.name);
    console.log("input:", JSON.stringify(tc.input));
    const output = await tc.output;
    console.log("output:", JSON.stringify(output));
  }

  console.log("=== 冒烟测试通过 ===");
}

main().catch((e) => {
  console.error("冒烟测试失败:", e);
  process.exit(1);
});
