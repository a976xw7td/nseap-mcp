/**
 * 端到端闭环测试（mock 模式）：提交 → 轮询任务 → 完成
 * 验证 M0 核心链路：submit_project 返回 task_id → get_task 轮询拿到完成状态
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";
import { PlatformClient } from "../src/client.js";
import { submitProject } from "../src/tools/submit.js";
import { getTask, listChallenges } from "../src/tools/read.js";

test("M0 闭环：提交 → task_id → 轮询 → completed", async () => {
  const cfg = loadConfig({ NSEAP_MOCK: "1", NSEAP_STUDENT_ID: "s001" });
  const client = new PlatformClient(cfg);

  // 1. 查挑战（拿 required_deliverables）
  const challenges = await listChallenges(client);
  assert.equal(challenges.ok, true);
  assert.ok(challenges.challenges.length > 0);
  const challenge = challenges.challenges[0];
  assert.ok(challenge.required_deliverables);

  // 2. 提交
  const submit = await submitProject(
    client,
    {
      studentId: cfg.studentId,
      challengeId: challenge.challenge_id,
      githubRepoUrl: "https://github.com/test/repo",
      projectTitle: "端到端测试项目",
      aarText: "端到端AAR复盘，验证完整闭环链路",
      selfEvaluationText: "端到端自评，验证完整闭环链路",
      isPublic: true,
    },
    null,
  );
  assert.equal(submit.ok, true);
  assert.ok(submit.task_id);

  // 3. 轮询任务状态
  const task = await getTask(client, submit.task_id);
  assert.equal(task.ok, true);
  assert.equal(task.status, "completed");
  assert.equal(task.result?.submissionId, "sub-mock");

  console.log("✅ M0 闭环验证通过:", { taskId: submit.task_id, status: task.status, submissionId: task.result?.submissionId });
});
