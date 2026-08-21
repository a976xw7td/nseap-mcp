/**
 * 发布挑战工具测试（mock 模式）
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";
import { PlatformClient } from "../src/client.js";
import { publishChallenge } from "../src/tools/publish.js";

function makeClient(): PlatformClient {
  const cfg = loadConfig({ NSEAP_MOCK: "1", NSEAP_STUDENT_ID: "s001" });
  return new PlatformClient(cfg);
}

const baseArgs = {
  title: "C03 · 提示词工程",
  deliverables: "提示词库 + 对比实验 + 优化记录 + AAR复盘",
  rubric: "五维评分",
  deadline: "2026-12-31",
};

test("publishChallenge mock 返回 challengeId", async () => {
  const result = await publishChallenge(makeClient(), baseArgs);
  assert.equal(result.ok, true);
  assert.ok(result.challengeId?.startsWith("task:task-mock"));
});

test("publishChallenge 带完整可选字段", async () => {
  const result = await publishChallenge(makeClient(), {
    ...baseArgs,
    brief: "提示词工程实战",
    objective: "掌握提示词设计",
    requiredDeliverables: "README.md, src/**",
    rubricDimensions: '{"dimensions":[]}',
  });
  assert.equal(result.ok, true);
});
