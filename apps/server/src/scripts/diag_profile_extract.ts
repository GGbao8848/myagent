// 诊断：extractObservationsAsync 提取逻辑是否工作
// 运行：npx tsx src/scripts/diag_profile_extract.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractObservationsAsync } from "../modules/profile/profile.service.js";

const envRaw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function main() {
  console.log("=== 手动调用 extractObservationsAsync ===");
  await extractObservationsAsync("br0002", [
    { role: "user", content: "你好，以后回答请尽量简洁，不要啰嗦" },
    { role: "assistant", content: "好的，明白了。我会保持简洁。" },
    { role: "user", content: "帮我查一下经纬度 121.4737, 31.2304 附近的瑞幸门店" },
  ]);
  console.log("调用完成");
}

main().catch((e) => {
  console.error("失败:", e);
  process.exit(1);
});
