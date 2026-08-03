// 验证：交错 runner 下事件时序 = 思考→工具→正文（工具块实时弹出，非攒到最后）
// 运行：npx tsx src/scripts/diag_interleave.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAgent } from "../agent/runner.js";
import { createBuiltinTools } from "../agent/tools.js";

const envRaw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function main() {
  const t0 = Date.now();
  const events: Array<{ t: number; evt: string; detail: string }> = [];
  const result = await runAgent({
    systemPrompt: "你是一个简洁的中文助手。需要计算时使用 calc 工具。",
    tools: createBuiltinTools(),
    messages: [{ role: "user", content: "请计算 123*456 等于多少？然后用一句话总结你做了什么" }],
    onEvent: (evt) => {
      const now = Date.now() - t0;
      if (evt.event === "tool_call") events.push({ t: now, evt: "tool_call", detail: (evt as any).tool_name });
      else if (evt.event === "tool_result") events.push({ t: now, evt: "tool_result", detail: String((evt as any).content).slice(0, 20) });
      else if (evt.event === "thinking") events.push({ t: now, evt: "thinking", detail: String((evt as any).content).slice(0, 16) });
      else if (evt.event === "content") events.push({ t: now, evt: "content", detail: String((evt as any).content).slice(0, 16) });
    },
  });

  console.log("=== 事件时间线（关键节点）===");
  // 只打印类型切换点，避免海量 thinking/content chunk
  let prevType = "";
  for (const e of events) {
    if (e.evt === "thinking" || e.evt === "content") {
      if (e.evt !== prevType) {
        console.log(`[+${e.t}ms] ${e.evt} 开始 ...`);
        prevType = e.evt;
      }
    } else {
      console.log(`[+${e.t}ms] ${e.evt} ${e.detail}`);
      prevType = e.evt;
    }
  }
  console.log("=== 汇总 ===");
  const firstTool = events.find((e) => e.evt === "tool_call");
  const firstContent = events.find((e) => e.evt === "content");
  const lastToolResult = [...events].reverse().find((e) => e.evt === "tool_result");
  console.log(`首个 tool_call: +${firstTool?.t}ms`);
  console.log(`末个 tool_result: +${lastToolResult?.t}ms`);
  console.log(`首个 content: +${firstContent?.t}ms`);
  console.log(`tool 阶段先于正文: ${(firstTool?.t ?? Infinity) < (firstContent?.t ?? 0)}`);
  console.log(`总耗时 ${Date.now() - t0}ms, 事件数 ${events.length}`);
  console.log(`result.content: ${JSON.stringify(result.content.slice(0, 60))}`);
}

main().catch((e) => {
  console.error("诊断失败:", e);
  process.exit(1);
});
