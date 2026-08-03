// 诊断：验证 runner 逐 chunk 增量 emit（打字机效果）+ </think> 标签不泄漏
// 运行：npx tsx src/scripts/diag_runner.ts
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

async function test(label: string, content: string) {
  console.log(`\n=== ${label} ===`);
  let thinkingChunks = 0;
  let contentChunks = 0;
  let thinkingTotal = 0;
  let contentTotal = 0;
  let leaks = 0;
  const evts: string[] = [];
  const t0 = Date.now();

  const result = await runAgent({
    systemPrompt: "你是一个简洁的中文助手，用中文回答。需要计算时使用 calc 工具。",
    tools: [calc],
    messages: [{ role: "user", content }],
    onEvent: (evt) => {
      evts.push(evt.event);
      if (evt.event === "thinking") {
        thinkingChunks++;
        thinkingTotal += (evt as any).content.length;
        if (String((evt as any).content).includes("</think>")) leaks++;
      } else if (evt.event === "content") {
        contentChunks++;
        contentTotal += (evt as any).content.length;
        if (String((evt as any).content).includes("</think>")) leaks++;
      }
    },
  });

  const ms = Date.now() - t0;
  console.log(`耗时 ${ms}ms`);
  console.log(`thinking: ${thinkingChunks} 个 chunk, 共 ${thinkingTotal} 字`);
  console.log(`content: ${contentChunks} 个 chunk, 共 ${contentTotal} 字`);
  console.log(`</think> 泄漏: ${leaks}`);
  console.log(`事件序列(前20): ${evts.slice(0, 20).join(",")}`);
  console.log(`result.thinking 前60: ${JSON.stringify(result.thinking.slice(0, 60))}`);
  console.log(`result.content: ${JSON.stringify(result.content.slice(0, 80))}`);
  if (contentChunks < 2 && contentTotal > 0) {
    console.log("⚠️ 正文没有逐 chunk（content 是一次性到达）");
  }
}

async function main() {
  await test("简单问答", "用一句话介绍你自己");
  await test("工具调用", "请计算 123*456 等于多少？");
  await test("工具后正文", "请计算 123*456 等于多少？然后用一句话总结你做了什么");
}

main().catch((e) => {
  console.error("诊断失败:", e);
  process.exit(1);
});
