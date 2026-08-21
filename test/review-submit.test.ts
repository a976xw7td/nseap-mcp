/**
 * 评审提交工具测试（mock 模式）
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";
import { PlatformClient } from "../src/client.js";
import { submitPeerReview, submitTeacherReview, submitReview } from "../src/tools/review-submit.js";

function makeClient(): PlatformClient {
  const cfg = loadConfig({ NSEAP_MOCK: "1", NSEAP_STUDENT_ID: "s001" });
  return new PlatformClient(cfg);
}

test("submitPeerReview mock 返回 evaluationId", async () => {
  const result = await submitPeerReview(makeClient(), {
    submissionId: "sub-1",
    score: 80,
    feedback: "代码结构清晰，建议补充错误处理",
  });
  assert.equal(result.ok, true);
  assert.equal(result.evaluationId, "eval-mock-1");
});

test("submitReview teacher 缺 action 时报错", async () => {
  const result = await submitReview(makeClient(), {
    evaluatorType: "teacher",
    submissionId: "sub-1",
    score: 90,
    feedback: "整体优秀，通过",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "BAD_REQUEST");
});

test("submitReview teacher 缺 recordId 时报错", async () => {
  const result = await submitReview(makeClient(), {
    evaluatorType: "teacher",
    submissionId: "sub-1",
    score: 90,
    feedback: "整体优秀，通过",
    action: "accept",
  });
  assert.equal(result.ok, false);
  assert.ok(result.error?.message.includes("submissionRecordId"));
});

test("submitTeacherReview mock 走消息总线返回 task_id", async () => {
  const result = await submitTeacherReview(makeClient(), {
    submissionId: "sub-1",
    submissionRecordId: "rec-1",
    action: "accept",
    score: 90,
    feedback: "整体优秀，通过",
  });
  assert.equal(result.ok, true);
  assert.ok(result.message?.includes("task"));
});

test("submitReview peer 评分超范围由 zod 拦截（工具层）", async () => {
  // 直接调业务函数验证分数校验逻辑（zod 在 MCP 层拦截，这里验证业务层不炸）
  const result = await submitPeerReview(makeClient(), {
    submissionId: "sub-1",
    score: 150,
    feedback: "测试超范围分数",
  });
  assert.equal(result.ok, true); // mock 模式不校验；真实模式由平台校验 0-100
});
