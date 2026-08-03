// 诊断：确认 createAgent v3 投影流结构（流式下逐 chunk？工具轮次消息序列？）
// 运行：npx tsx src/scripts/diag_stream.ts
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";
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
  streaming: true,
});

const calc = tool(
  async ({ a, b }: { a: number; b: number }) => `结果: ${a * b}`,
  {
    name: "calc",
    description: "计算两数相乘",
    schema: z.object({ a: z.number(), b: z.number() }),
  }
);

async function dumpTurn(messages: Array<{ role: string; content: string }>, label: string) {
  const agent = createAgent({
    model,
    tools: [calc],
    systemPrompt: "你是一个简洁的中文助手，用中文回答。需要计算时使用 calc 工具。",
  });
  console.log(`\n=== ${label} ===`);
  const run = await agent.streamEvents({ messages }, { version: "v3" });

  let msgIdx = 0;
  for await (const msg of run.messages) {
    // 逐 chunk 消费 text，记录 chunk 到达时间
    const chunkTimes: number[] = [];
    const t0 = Date.now();
    let text = "";
    for await (const chunk of msg.text) {
      text += chunk;
      chunkTimes.push(Date.now() - t0);
    }
    // 探测 toolCalls（尝试两遍，验证可重复迭代）
    let tcProbe: any[] = [];
    try {
      for await (const tc of msg.toolCalls) tcProbe.push(tc);
    } catch (e) {
      tcProbe = [`ERR:${(e as Error).message.slice(0, 40)}`];
    }
    let tcProbe2: any[] = [];
    try {
      for await (const tc of msg.toolCalls) tcProbe2.push(tc);
    } catch (e) {
      tcProbe2 = [`ERR:${(e as Error).message.slice(0, 40)}`];
    }
    console.log(`[msg#${msgIdx}] messageType=${JSON.stringify((msg as any).messageType)} toolCalls=${tcProbe.length} 再迭代=${tcProbe2.length}`);
    console.log(`   text=${text.length}字 chunks=${chunkTimes.length} 首chunk=${chunkTimes[0] ?? "-"}ms 末chunk=${chunkTimes.at(-1) ?? "-"}ms 间隔分布=${chunkTimes.length > 5 ? `[${chunkTimes[0]}..${chunkTimes.at(-1)}]` : JSON.stringify(chunkTimes)}`);
    console.log(`   text前80: ${JSON.stringify(text.slice(0, 80))}`);
    for (const tc of tcProbe) {
      console.log(`   tc: name=${(tc as any).name} callId=${String((tc as any).callId).slice(0, 12)} input=${JSON.stringify((tc as any).input)}`);
    }
    msgIdx++;
  }

  // run.toolCalls
  let tcCount = 0;
  try {
    for await (const tc of run.toolCalls) {
      tcCount++;
      const output = await tc.output;
      console.log(`[run.toolCalls#${tcCount}] name=${tc.name} output=${JSON.stringify(String(output).slice(0, 40))}`);
    }
  } catch (e) {
    console.log("run.toolCalls 迭代错误:", (e as Error).message.slice(0, 60));
  }
  console.log(`   run.toolCalls 总数: ${tcCount}`);
}

async function main() {
  // 场景 1：简单问答（无工具，观察 </think> 与增量）
  await dumpTurn(
    [{ role: "user", content: "用一句话介绍你自己" }],
    "简单问答（无工具）"
  );
  // 场景 2：需要工具
  await dumpTurn(
    [{ role: "user", content: "请计算 123*456 等于多少？" }],
    "工具轮次"
  );
}

main().catch((e) => {
  console.error("诊断失败:", e);
  process.exit(1);
});
