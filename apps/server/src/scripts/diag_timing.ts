// 诊断：验证新 runner 逐 chunk emit 的"到达时间"是否分散（打字机时间分布）
// 运行：npx tsx src/scripts/diag_timing.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tool } from "langchain";
import { z } from "zod";
import { runAgent } from "../agent/runner.js";

const envRaw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const calc = tool(async ({ a, b }: { a: number; b: number }) => `结果: ${a * b}`, {
  name: "calc",
  description: "计算两数相乘",
  schema: z.object({ a: z.number(), b: z.number() }),
});

async function main() {
  const t0 = Date.now();
  let firstThinking = -1;
  let firstContent = -1;
  let lastThinking = -1;
  let lastContent = -1;
  let nThinking = 0;
  let nContent = 0;

  const result = await runAgent({
    systemPrompt: "你是一个简洁的中文助手，用中文回答。需要计算时使用 calc 工具。",
    tools: [calc],
    messages: [{ role: "user", content: "请计算 123*456 等于多少？然后用一句话总结" }],
    onEvent: (evt) => {
      const now = Date.now() - t0;
      if (evt.event === "thinking") {
        nThinking++;
        if (firstThinking < 0) firstThinking = now;
        lastThinking = now;
        if (nThinking <= 3) console.log(`  [+${now}ms] thinking: ${String((evt as any).content).slice(0, 20)}`);
      } else if (evt.event === "content") {
        nContent++;
        if (firstContent < 0) firstContent = now;
        lastContent = now;
        if (nContent <= 3) console.log(`  [+${now}ms] content: ${String((evt as any).content).slice(0, 20)}`);
      } else if (evt.event === "tool_call") {
        console.log(`  [+${now}ms] tool_call: ${(evt as any).tool_name}`);
      }
    },
  });

  console.log("=== 汇总 ===");
  console.log(`总耗时: ${Date.now() - t0}ms`);
  console.log(`thinking: ${nThinking} chunk, 首个+${firstThinking}ms, 末个+${lastThinking}ms`);
  console.log(`content:  ${nContent} chunk, 首个+${firstContent}ms, 末个+${lastContent}ms`);
  console.log(`result.content: ${JSON.stringify(result.content.slice(0, 60))}`);
}

main().catch((e) => {
  console.error("诊断失败:", e);
  process.exit(1);
});
