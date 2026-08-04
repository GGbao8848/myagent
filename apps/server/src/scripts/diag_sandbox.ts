// 验证：沙箱 AST 检查 + run_python 工具
// 运行：npx tsx src/scripts/diag_sandbox.ts
import { checkPythonSafety } from "../agent/sandbox.js";
import { createBuiltinTools } from "../agent/tools.js";

async function main() {
  const runPython = createBuiltinTools().find((t) => t.name === "run_python");
  if (!runPython) {
    console.log("run_python 工具未找到");
    return;
  }

  console.log("=== 1. AST 安全检查 ===");
  const cases: Array<[string, string]> = [
    ["安全计算", "import math\nprint(math.sqrt(16))"],
    ["安全正则", "import re\nprint(re.findall(r'\\\\d+', 'a1b2'))"],
    ["危险 os.system", "import os\nos.system('rm -rf /')"],
    ["危险 eval", "print(eval('1+1'))"],
    ["危险 subprocess", "import subprocess\nsubprocess.run(['ls'])"],
    ["危险文件写", "open('/etc/passwd', 'w').write('x')"],
    ["安全 json", "import json\nprint(json.dumps({'a': 1}))"],
    ["语法错误", "def broken(:\n"],
  ];
  for (const [label, code] of cases) {
    const r = await checkPythonSafety(code);
    console.log(`  ${label}: ${r.safe ? "通过" : "拒绝 - " + r.reason}`);
  }

  console.log("\n=== 2. run_python 工具执行 ===");
  const res = await runPython.invoke({
    code: "import math\nprint('sqrt(16) =', math.sqrt(16))\nprint(sum(range(101)))",
  });
  console.log("  安全代码输出:", typeof res === "string" ? res.slice(0, 200) : res);

  console.log("\n=== 3. run_python 危险代码 ===");
  const res2 = await runPython.invoke({
    code: "import os\nos.system('echo hacked')",
  });
  console.log("  危险代码输出:", typeof res2 === "string" ? res2.slice(0, 200) : res2);
}

main().catch((e) => {
  console.error("诊断失败:", e);
  process.exit(1);
});
