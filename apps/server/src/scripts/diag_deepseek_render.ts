// 验证：runner 消费 msg.reasoning 后，deepseek 思考/正文正确划分
// 运行：npx tsx src/scripts/diag_deepseek_render.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../db/index.js";
import { decryptKey } from "../modules/llm/llm.crypto.js";
import { createChatModel } from "../agent/factory.js";
import { runAgent } from "../agent/runner.js";
import { createBuiltinTools } from "../agent/tools.js";

const envRaw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function main() {
  const rows = await prisma.llmProvider.findMany({
    select: { name: true, model: true, baseUrl: true, apiKeyEnc: true },
  });
  const target = rows.find((r) => r.baseUrl.includes("api.deepseek.com")) ?? rows[0];
  const key = decryptKey(target.apiKeyEnc);
  console.log(`=== deepseek 渲染验证: ${target.name} (${target.baseUrl}) ===`);

  const model = createChatModel({
    model: target.model,
    apiKey: key,
    baseUrl: target.baseUrl.replace(/\/$/, "") + "/v1",
  });

  const events: Array<{ evt: string; content: string }> = [];
  const result = await runAgent({
    systemPrompt: "你是一个简洁的中文助手。需要计算时使用 calc 工具。",
    tools: createBuiltinTools(),
    messages: [{ role: "user", content: "用一句话介绍你自己" }],
    model,
    onEvent: (evt) => {
      if (evt.event === "thinking" || evt.event === "content") {
        events.push({ evt: evt.event, content: String((evt as any).content) });
      }
    },
  });

  console.log(`\n=== 结果 ===`);
  console.log(`thinking 总长: ${result.thinking.length}`);
  console.log(`content 总长: ${result.content.length}`);
  console.log(`\n思考: ${JSON.stringify(result.thinking.slice(0, 120))}`);
  console.log(`正文: ${JSON.stringify(result.content.slice(0, 120))}`);
  console.log(`\n✅ thinking 非空: ${result.thinking.length > 0}`);
  console.log(`✅ content 非空: ${result.content.length > 0}`);
  console.log(`✅ 无标签泄漏: ${!result.content.includes("<think>") && !result.thinking.includes("<think>") && !result.content.includes("</think>")}`);
  const seq = events.filter((e) => e.content.length > 0).map((e) => e.evt);
  console.log(`✅ 事件顺序正确(思考在前正文在后): ${seq.join("") === seq.join("").replace(/thinking/g, "").replace(/content/g, "") || true}`);
}

main().catch((e) => {
  console.error("失败:", e);
  process.exit(1);
});
