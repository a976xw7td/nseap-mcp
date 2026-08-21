/**
 * M1 工具测试（get_evaluation / get_dashboard / health，mock 模式）
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";
import { PlatformClient } from "../src/client.js";
import { getEvaluation, getDashboard, checkHealth } from "../src/tools/review.js";

function makeClient(): PlatformClient {
  const cfg = loadConfig({ NSEAP_MOCK: "1", NSEAP_STUDENT_ID: "s001" });
  return new PlatformClient(cfg);
}

test("getDashboard mock 返回统计", async () => {
  const result = await getDashboard(makeClient());
  assert.equal(result.ok, true);
  assert.equal(result.stats?.studentCount, 1);
  assert.equal(typeof result.stats?.challengeCount, "number");
  assert.equal(typeof result.stats?.submissionCount, "number");
});

test("getEvaluation 无记录时返回 NOT_FOUND", async () => {
  const result = await getEvaluation(makeClient(), { submissionId: "sub-none" });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "NOT_FOUND");
});

test("checkHealth mock 返回 ok", async () => {
  const result = await checkHealth(makeClient());
  assert.equal(result.ok, true);
  assert.equal(result.mode, "mock");
  assert.equal(typeof result.latencyMs, "number");
});
