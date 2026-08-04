// 验证：内存监控（无限分配内存被 kill）
import { createBuiltinTools } from "../agent/tools.js";

async function main() {
  const runPython = createBuiltinTools().find((t) => t.name === "run_python");
  const res = await runPython.invoke({
    code: "x = []\nwhile True:\n    x.append([0] * 1000000)",
    maxMemoryMb: 100,
  });
  console.log("无限分配输出:", typeof res === "string" ? res.slice(0, 200) : res);
}

main().catch((e) => {
  console.error("失败:", e);
  process.exit(1);
});
