/**
 * 提交工具单元测试（mock 模式）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { loadConfig } from "../src/config.js";
import { PlatformClient } from "../src/client.js";
import { submitProject } from "../src/tools/submit.js";

function makeClient(): PlatformClient {
  const cfg = loadConfig({ NSEAP_MOCK: "1", NSEAP_STUDENT_ID: "s001" });
  return new PlatformClient(cfg);
}

const baseArgs = {
  studentId: "s001",
  challengeId: "ch-1",
  githubRepoUrl: "https://github.com/test/repo",
  projectTitle: "测试项目",
  aarText: "这是AAR复盘，包含方法论总结",
  selfEvaluationText: "这是自评，对自己的项目进行完整评估",
  isPublic: true,
};

test("submitProject mock 模式返回 task_id", async () => {
  const client = makeClient();
  const result = await submitProject(client, baseArgs, null);
  assert.equal(result.ok, true);
  assert.ok(result.task_id?.startsWith("task-mock-"));
  assert.equal(result.status, "pending");
});

test("submitProject 缺交付物时拦截（不消耗平台资源）", async () => {
  const client = makeClient();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nseap-submit-test-"));
  try {
    fs.writeFileSync(path.join(dir, "README.md"), "# x");
    const result = await submitProject(
      client,
      { ...baseArgs, workdir: dir },
      "README.md, reflection.md",
    );
    assert.equal(result.ok, false);
    assert.equal(result.task_id, undefined); // 未入队
    assert.ok(result.error?.message.includes("缺少交付物: reflection.md"));
    assert.equal(result.localIssues?.find((i) => i.pattern === "reflection.md")?.found, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("submitProject 交付物齐全时放行", async () => {
  const client = makeClient();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nseap-submit-test-"));
  try {
    fs.writeFileSync(path.join(dir, "README.md"), "# x");
    fs.writeFileSync(path.join(dir, "reflection.md"), "AAR");
    const result = await submitProject(
      client,
      { ...baseArgs, workdir: dir },
      "README.md, reflection.md",
    );
    assert.equal(result.ok, true);
    assert.ok(result.task_id);
    assert.deepEqual(result.localIssues?.filter((i) => !i.found), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("submitProject blockOnMissing=false 时带警告放行", async () => {
  const client = makeClient();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nseap-submit-test-"));
  try {
    fs.writeFileSync(path.join(dir, "README.md"), "# x");
    const result = await submitProject(
      client,
      { ...baseArgs, workdir: dir, blockOnMissing: false },
      "README.md, reflection.md",
    );
    assert.equal(result.ok, true);
    assert.ok(result.localIssues?.some((i) => i.pattern === "reflection.md" && !i.found));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
