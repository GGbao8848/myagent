// 诊断：run.toolCalls 是否实时 yield（工具执行完立即 yield）？
// 同时推进 run.messages 与 run.toolCalls，记录事件时间线，判断能否实现"工具动态弹出"。
// 运行：npx tsx src/scripts/diag_tool_timing.ts
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
    { messages: [{ role: "user", content: "请计算 123*456 等于多少？" }] },
    { version: "v3" }
  );

  const t0 = Date.now();
  const log = (tag: string, detail = "") => {
    const d = String(Date.now() - t0).padStart(5);
    console.log(`[+${d}ms] ${tag} ${detail}`);
  };

  const msgIter = run.messages[Symbol.asyncIterator]();
  const tcIter = run.toolCalls[Symbol.asyncIterator]();

  // 交错推进两个流：谁先有数据谁先处理
  let msgDone = false;
  let tcDone = false;
  let pendingMsgs: any[] = [];
  let msgInFlight: Promise<any> | null = null;
  let tcInFlight: Promise<any> | null = null;

  const pump = () => {
    if (!msgInFlight && !msgDone) {
      msgInFlight = msgIter.next().then((r) => {
        msgInFlight = null;
        if (r.done) msgDone = true;
        return r;
      });
    }
    if (!tcInFlight && !tcDone) {
      tcInFlight = tcIter.next().then((r) => {
        tcInFlight = null;
        if (r.done) tcDone = true;
        return r;
      });
    }
  };

  pump();
  while (!msgDone || !tcDone) {
    const msgP: Promise<any> | null = msgInFlight;
    const tcP: Promise<any> | null = tcInFlight;
    pump();
    if (msgP && tcP) {
      const [mr, tr] = await Promise.all([msgP, tcP]) as [any, any];
      if (!mr.done) {
        const msg = mr.value;
        // 消费文本 chunks
        const texts: string[] = [];
        try {
          for await (const c of msg.text as AsyncIterable<string>) texts.push(c);
        } catch {}
        log("msg", `text=${texts.join("").slice(0, 30)} toolCalls=${(msg.toolCalls as any)?.length ?? "?"}`);
        if (!tr.done) {
          const tc = tr.value;
          const out = await tc.output;
          log("tool", `${tc.name} output=${JSON.stringify(out).slice(0, 30)}`);
        }
      } else if (!tr.done) {
        const tc = tr.value;
        const out = await tc.output;
        log("tool", `${tc.name} output=${JSON.stringify(out).slice(0, 30)}`);
      }
    } else if (msgP) {
      const mr = await msgP as any;
      if (!mr.done) {
        const msg = mr.value;
        const texts: string[] = [];
        try {
          for await (const c of msg.text as AsyncIterable<string>) texts.push(c);
        } catch {}
        log("msg", `text=${texts.join("").slice(0, 30)}`);
      }
    } else if (tcP) {
      const tr = await tcP as any;
      if (!tr.done) {
        const tc = tr.value;
        const out = await tc.output;
        log("tool", `${tc.name} output=${JSON.stringify(out).slice(0, 30)}`);
      }
    }
  }
  log("done");
}

main().catch((e) => {
  console.error("诊断失败:", e);
  process.exit(1);
});
