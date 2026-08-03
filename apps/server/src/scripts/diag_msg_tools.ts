// 诊断：确认 msg.toolCalls 是否含可 await 的 output（决定工具事件能否在消息内立即弹出）
// 运行：npx tsx src/scripts/diag_msg_tools.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAgent } from "../agent/factory.js";
import { createBuiltinTools } from "../agent/tools.js";

const envRaw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function main() {
  const agent = createAgent({
    tools: createBuiltinTools(),
    systemPrompt: "你是一个简洁的中文助手。需要计算时使用 calc 工具。",
  });
  const run = await agent.streamEvents(
    {
      messages: [
        { role: "user", content: "请计算 123*456 等于多少？" },
      ],
    },
    { version: "v3" }
  );

  let msgIdx = 0;
  for await (const msg of run.messages) {
    let hasOut = false;
    let outputVal: unknown = "N/A";
    let outErr = "";
    try {
      for await (const tc of msg.toolCalls as AsyncIterable<any>) {
        if ("output" in tc) {
          hasOut = true;
          try {
            outputVal = await tc.output;
          } catch (e) {
            outputVal = `ERR:${(e as Error).message.slice(0, 40)}`;
          }
        }
      }
    } catch (e) {
      outErr = (e as Error).message.slice(0, 60);
    }
    console.log(`[msg#${msgIdx}] hasOutput=${hasOut} output=${JSON.stringify(outputVal).slice(0, 60)} iterErr=${outErr}`);
    msgIdx++;
  }
}

main().catch((e) => {
  console.error("诊断失败:", e);
  process.exit(1);
});
