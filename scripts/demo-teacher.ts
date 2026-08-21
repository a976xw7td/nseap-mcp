#!/usr/bin/env node
/**
 * 教师全流程预演（mock 模式）——发布挑战 → 学生提交 → 教师终审 → 同伴评审
 * 验证 teacher 角色的 13 工具面（含 nseap_publish_challenge 角色裁剪）
 *
 * 运行：NSEAP_MOCK=1 NSEAP_STUDENT_ID=teacher-demo NSEAP_ROLE=teacher \
 *       node scripts/demo-teacher.ts
 */
import { loadConfig } from "../src/config.js";
import { PlatformClient } from "../src/client.js";
import { publishChallenge } from "../src/tools/publish.js";
import { submitProject } from "../src/tools/submit.js";
import { submitReview } from "../src/tools/review-submit.js";
import { sendNotification } from "../src/tools/review.js";

const step = (n: string, title: string) => console.log(`\n【${n}】${title}\n${"─".repeat(50)}`);

async function main() {
  const config = loadConfig();
  const client = new PlatformClient(config);
  const start = Date.now();

  console.log("👩‍🏫 NSEAP × CogSeed 教师全流程预演");
  console.log(`   模式=${client.modeForLog()} · 角色=${config.role} · 平台=${client.serverUrlForLog()}`);

  // ── 1. 教师发布挑战 ──
  step("1", "教师发布新挑战（nseap_publish_challenge，仅 teacher 暴露）");
  const pub = await publishChallenge(client, {
    title: "C11 · 数据可视化项目（mock）",
    brief: "用 AI 完成一个数据可视化小项目",
    deliverables: "可视化页面 + 数据源说明 + AAR复盘",
    rubric: "四维评估：拿来主义/有效反馈/多次迭代/可复用性",
    requiredDeliverables: "README.md, src/**, AAR复盘.md",
    deadline: "2026-09-15",
  });
  if (!pub.ok) throw new Error(`发布失败: ${JSON.stringify(pub.error)}`);
  console.log(`   ✅ 已发布: ${pub.challengeId}`);
  console.log("   📱 班级群飞书公告：📢 新 Challenge 发布 C11（mock）");

  // ── 2. 教师发通知 ──
  step("2", "教师发班级群提醒（nseap_notify）");
  const notify = await sendNotification(client, {
    target: "class_group",
    text: "📢 提醒：C11 数据可视化项目已发布，截止 09-15，请同学们及时提交！",
  });
  console.log(`   ✅ 通知已入队: ${notify.ok}`);

  // ── 3. 模拟学生提交 ──
  step("3", "（学生侧）学生提交 C11");
  const submit = await submitProject(
    client,
    {
      studentId: config.studentId,
      challengeId: "ch-mock-c03",
      githubRepoUrl: "https://github.com/demo/visualization",
      projectTitle: "数据可视化小项目",
      aarText: "AAR：学会了用 AI 生成图表代码，卡在数据清洗。",
      selfEvaluationText: "自评：完成 3 类图表，迭代 2 轮。",
      isPublic: true,
    },
    null,
  );
  if (!submit.ok) throw new Error(`提交失败: ${JSON.stringify(submit.error)}`);
  console.log(`   ✅ 学生已提交: task=${submit.task_id}`);

  // ── 4. 教师终审 ──
  step("4", "教师终审（nseap_submit_review，teacher → 消息总线）");
  const review = await submitReview(client, {
    evaluatorType: "teacher",
    submissionId: "sub-mock",
    submissionRecordId: "rec-mock-1",
    action: "accept",
    score: 85,
    feedback: "可视化完成度高，数据源说明清晰，AAR 复盘有改进方案。通过。",
  });
  console.log(`   ✅ 终审结果: ${review.ok ? review.message : JSON.stringify(review.error)}`);
  console.log("   📱 学生收到飞书卡片：📢 评审结果 已通过 85分 [查看ΔR分析]");

  // ── 5. 同伴评审 ──
  step("5", "同伴评审（nseap_submit_review，peer → 平台校验分配）");
  const peer = await submitReview(client, {
    evaluatorType: "peer",
    submissionId: "sub-mock",
    score: 80,
    feedback: "图表配色可以更统一，建议引入主题色。数据部分很扎实。",
  });
  console.log(`   ✅ 同伴评审: ${peer.ok ? `evaluationId=${peer.evaluationId}` : JSON.stringify(peer.error)}`);

  console.log(`\n✅ 教师全流程预演完成（${Date.now() - start}ms），5 步全部走通`);
}

main().catch((err) => {
  console.error("❌ 教师预演失败:", err instanceof Error ? err.message : err);
  process.exit(1);
});
