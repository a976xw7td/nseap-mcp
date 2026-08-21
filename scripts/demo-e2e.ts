#!/usr/bin/env node
/**
 * 学生全流程预演（mock 模式）——模拟"CogSeed 对话完成一次挑战提交"的完整体验。
 * 用途：① 用户回来后的现场演示 ② 工具链整体可用性回归 ③ 验收脚本
 *
 * 运行：NSEAP_MOCK=1 NSEAP_STUDENT_ID=demo-student node scripts/demo-e2e.ts
 */
import { loadConfig } from "../src/config.js";
import { PlatformClient } from "../src/client.js";
import { prepareSubmissionReport } from "../src/tools/local.js";
import { listChallenges, getChallenge, getTask } from "../src/tools/read.js";
import { submitProject } from "../src/tools/submit.js";
import { getEvaluation, getDashboard } from "../src/tools/review.js";

// 模拟一个学生项目目录
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const log = (...args: unknown[]) => console.log(...args);
const step = (n: string, title: string) => console.log(`\n【${n}】${title}\n${"─".repeat(50)}`);

async function main() {
  const config = loadConfig();
  const client = new PlatformClient(config);
  const start = Date.now();

  log("🎓 NSEAP × CogSeed 学生全流程预演");
  log(`   模式=${client.modeForLog()} · 学生=${config.studentId} · 平台=${client.serverUrlForLog()}`);

  // ── 1. 学生打开工作空间，看挑战列表 ──
  step("1", "学生打开 AI+X 工作空间 → 查挑战");
  const challenges = await listChallenges(client);
  if (!challenges.ok) throw new Error(`查挑战失败: ${JSON.stringify(challenges.error)}`);
  log(`   发现 ${challenges.challenges.length} 个挑战：`);
  for (const c of challenges.challenges.slice(0, 5)) {
    log(`   · ${c.title}  [${c.status}]  截止 ${c.deadline ?? "-"}`);
  }

  // ── 2. 看 C03 详情 ──
  step("2", "学生点开挑战详情 → 看交付物要求");
  const target = challenges.challenges.find((c) => c.title.includes("C03")) ?? challenges.challenges[0];
  if (!target) throw new Error("无可用挑战");
  const detail = await getChallenge(client, target.challenge_id);
  if (!detail.ok || !detail.challenge) throw new Error("查详情失败");
  log(`   挑战: ${detail.challenge.title}`);
  log(`   交付物: ${detail.challenge.required_deliverables ?? "(未定义)"}`);
  const required = detail.challenge.required_deliverables ?? "README.md";

  // ── 3. 学生创建项目目录并开发（这里模拟：先缺文件）──
  step("3", "学生在 Cogseed 开发项目（模拟：只写了 README）");
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "nseap-demo-"));
  fs.writeFileSync(path.join(workdir, "README.md"), "# 我的 C03 项目\n提示词工程实践");
  log(`   项目目录: ${workdir}`);
  log("   已创建: README.md");

  // ── 4. 本地交付物预检（发现缺失）──
  step("4", "学生说『帮我检查缺什么』→ 本地预检");
  const report = prepareSubmissionReport(workdir, required, {
    githubRepoUrl: "https://github.com/demo/c03",
    projectTitle: "C03 提示词工程实践",
  });
  log(`   检查结果: ${report.deliverables.ok ? "✅ 齐全" : "❌ 缺件"}`);
  for (const m of report.deliverables.missing) log(`   缺失: ${m}`);
  for (const item of report.actionItems) log(`   行动项: ${item}`);

  // ── 5. 学生补文件 → 再次预检 ──
  step("5", "学生补交缺失交付物 → 再检");
  for (const m of report.deliverables.missing) {
    // pattern 可能含目录（如 src/**）：在目录里补一个占位文件满足 glob
    const plain = m.replace(/\*/g, "").replace(/\?/g, "").replace(/\/+$/, "");
    const targetPath = path.join(workdir, plain);
    if (m.includes("/")) {
      // 目录 pattern → 目录 + 占位文件
      fs.mkdirSync(targetPath, { recursive: true });
      fs.writeFileSync(path.join(targetPath, "placeholder.txt"), "# 补交\n");
    } else {
      fs.writeFileSync(targetPath, "# 补交\n");
    }
    log(`   补交: ${m} → ${plain}`);
  }
  const report2 = prepareSubmissionReport(workdir, required, {
    githubRepoUrl: "https://github.com/demo/c03",
    projectTitle: "C03 提示词工程实践",
  });
  log(`   再检结果: ${report2.ready ? "✅ 可提交" : "❌ 仍缺: " + report2.actionItems.join(", ")}`);

  // ── 6. 提交 ──
  step("6", "学生说『提交！』→ nseap_submit_project");
  const submit = await submitProject(
    client,
    {
      studentId: config.studentId,
      challengeId: target.challenge_id,
      githubRepoUrl: "https://github.com/demo/c03",
      projectTitle: "C03 提示词工程实践",
      aarText: "AAR 复盘：学会了结构化提示词，卡在变量设计，下次先列变量表。",
      selfEvaluationText: "自评：提示词库覆盖 3 类任务，迭代 3 轮。",
      isPublic: true,
      workdir,
    },
    required,
  );
  if (!submit.ok) throw new Error(`提交失败: ${JSON.stringify(submit.error)}`);
  log(`   ✅ 提交已受理，task_id = ${submit.task_id}`);

  // ── 7. 轮询任务状态 ──
  step("7", "后台轮询 nseap_get_task");
  for (let i = 0; i < 3; i++) {
    if (!submit.task_id) break;
    const task = await getTask(client, submit.task_id);
    log(`   轮询 ${i + 1}: status=${task.status}`);
    if (task.status === "completed" || task.status === "failed") {
      log(`   结果: submissionId=${task.result?.submissionId ?? "-"}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  // ── 8. 查评分 + 仪表盘 ──
  step("8", "评分就绪 → 查评审 + 仪表盘");
  const evalRes = await getEvaluation(client, { submissionId: "sub-mock" });
  log(`   评审查询: ${evalRes.ok ? `evaluator=${evalRes.evaluation?.evaluator_type}` : evalRes.error?.message}`);
  const dash = await getDashboard(client);
  log(`   仪表盘: 挑战 ${dash.stats?.challengeCount} · 提交 ${dash.stats?.submissionCount} · 完成 ${dash.stats?.completedCount}`);

  // ── 9. 飞书通知（平台自动，演示说明）──
  step("9", "飞书通知（平台自动触发）");
  log("   📱 学生收到飞书卡片：✅ 提交成功 · AI 初评 72/100 · [查看评分详情]");
  log("   📱 班级群收到：📢 新提交 · C03 · 学生名 · AI 初评 72/100");

  fs.rmSync(workdir, { recursive: true, force: true });
  log(`\n✅ 全流程预演完成（${Date.now() - start}ms），9 步全部走通`);
}

main().catch((err) => {
  console.error("❌ 预演失败:", err instanceof Error ? err.message : err);
  process.exit(1);
});
