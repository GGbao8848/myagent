// 验证：记忆优化（置信度衰减 + 相似去重 + 注入过滤）
// 运行：npx tsx src/scripts/diag_profile_opt.ts
import { prisma } from "../db/index.js";
import { createObservation, getProfilePrompt } from "../modules/profile/profile.service.js";

const TEST_OWNER = "__diag_opt__";

async function main() {
  // 清理测试数据
  await prisma.profileObservation.deleteMany({ where: { owner: TEST_OWNER } });

  console.log("=== 1. 相似去重 ===");
  const a = await createObservation(TEST_OWNER, "用户喜欢简洁回复", "explicit");
  const b = await createObservation(TEST_OWNER, "用户喜欢简洁的回复方式", "explicit");
  console.log(`精确创建: confidence=${a.confidence}, seen=${a.seenCount}`);
  console.log(`相似创建(应合并): confidence=${b.confidence}, seen=${b.seenCount}`);
  const count = await prisma.profileObservation.count({ where: { owner: TEST_OWNER } });
  console.log(`总条数(应为1): ${count}`);
  console.log(`✅ 相似去重: ${count === 1 && b.seenCount === 2}`);

  console.log("\n=== 2. 注入过滤 ===");
  // 创建一条低置信度观察
  await prisma.profileObservation.updateMany({
    where: { owner: TEST_OWNER },
    data: { confidence: 0.2 }, // 低于 INJECT_MIN_CONFIDENCE (0.5)
  });
  const prompt = await getProfilePrompt(TEST_OWNER);
  console.log(`低置信度观察注入结果: ${prompt === "" ? "被过滤(空)" : "被注入(异常)"}`);
  console.log(`✅ 低置信度过滤: ${prompt === ""}`);

  console.log("\n=== 3. 置信度衰减 ===");
  const row = await prisma.profileObservation.findFirst({ where: { owner: TEST_OWNER } });
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
  await prisma.profileObservation.update({
    where: { id: row!.id },
    data: { confidence: 0.8, lastSeenAt: tenDaysAgo },
  });
  // 调用一次提取（触发衰减，但模型调用可能慢/失败，只验证衰减逻辑）
  const { extractObservationsAsync } = await import("../modules/profile/profile.service.js");
  await extractObservationsAsync(TEST_OWNER, [{ role: "user", content: "测试" }]);
  const after = await prisma.profileObservation.findFirst({ where: { owner: TEST_OWNER } });
  console.log(`衰减前 confidence=0.8, 10天后 → ${after?.confidence}`);
  const expected = Math.max(0.1, Math.round((0.8 - 10 * 0.05) * 100) / 100);
  console.log(`期望≈${expected}`);
  console.log(`✅ 衰减生效: ${Math.abs((after?.confidence ?? 0) - expected) < 0.05}`);

  // 清理
  await prisma.profileObservation.deleteMany({ where: { owner: TEST_OWNER } });
  console.log("\n=== 清理完成 ===");
}

main().catch((e) => {
  console.error("诊断失败:", e);
  process.exit(1);
});
