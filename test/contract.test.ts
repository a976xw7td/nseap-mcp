/**
 * 契约测试（consumer-driven contract test）
 *
 * 按平台真实路由契约（app/api 下的 route.ts）模拟平台行为，验证 nseap-mcp
 * 客户端的请求字段/响应解析与平台完全一致 —— 平台不可达时也能保证
 * "接通即能用"。
 *
 * 模拟的契约（从 nseap-platform 源码逐行对齐）：
 * - POST /api/nseap：读 { message_type, to_agent, payload }；401 无有效 key；
 *   200 { ok, task_id } / 503 { ok:false, error }
 * - GET  /api/challenges：200 { ok, challenges: [...] }
 * - GET  /api/tasks/:id：200 { ok, task } / 404 { ok:false, error }
 * - POST /api/evaluations：读 { evaluator_type, submissionId, score, feedback }
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { loadConfig } from "../src/config.js";
import { PlatformClient } from "../src/client.js";
import { submitProject } from "../src/tools/submit.js";
import { listChallenges, getTask } from "../src/tools/read.js";
import { submitPeerReview } from "../src/tools/review-submit.js";

/** 记录收到的请求，按平台契约响应 */
function startFakePlatform(handler: (req: http.IncomingMessage, body: unknown) => { status: number; body: unknown }) {
  const requests: Array<{ url: string; method: string; headers: http.IncomingHttpHeaders; body: unknown }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: unknown = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      requests.push({ url: req.url ?? "", method: req.method ?? "", headers: req.headers, body });
      const resp = handler(req, body);
      res.writeHead(resp.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(resp.body));
    });
  });
  return new Promise<{ server: http.Server; requests: typeof requests; url: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, requests, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

test("契约：submit_project 请求字段与平台 /api/nseap 期望一致", async () => {
  const fake = await startFakePlatform((req, body) => {
    if (req.url === "/api/nseap") {
      const b = body as Record<string, unknown>;
      // 平台契约：必须含 message_type 和 payload
      if (!b.message_type || !b.payload) {
        return { status: 400, body: { ok: false, error: "缺少 message_type 或 payload" } };
      }
      return { status: 200, body: { ok: true, task_id: "task-contract-1" } };
    }
    return { status: 404, body: { ok: false, error: "not found" } };
  });
  try {
    const cfg = loadConfig({
      NSEAP_SERVER_URL: fake.url,
      NSEAP_API_KEY: "test-key",
      NSEAP_STUDENT_ID: "s001",
    });
    const client = new PlatformClient(cfg);
    const result = await submitProject(
      client,
      {
        studentId: "s001",
        challengeId: "ch-1",
        githubRepoUrl: "https://github.com/x/y",
        projectTitle: "契约测试",
        aarText: "契约测试AAR复盘内容",
        selfEvaluationText: "契约测试自评内容",
        isPublic: true,
      },
      null,
    );
    assert.equal(result.ok, true);
    assert.equal(result.task_id, "task-contract-1");

    // 验证发出的请求符合平台契约
    const req = fake.requests.find((r) => r.url === "/api/nseap");
    assert.ok(req, "必须调用 /api/nseap");
    assert.equal(req.headers["x-api-key"], "test-key");
    const body = req.body as Record<string, unknown>;
    assert.equal(body.message_type, "submission_request");
    assert.equal(body.to_agent, "submission-task-agent-001");
    const payload = body.payload as Record<string, unknown>;
    assert.equal(payload.challengeId, "ch-1");
    assert.equal(payload.studentId, "s001"); // 身份注入（不可伪造）
    assert.ok(payload.audit_trace_pointer, "必须带审计指针");
  } finally {
    fake.server.close();
  }
});

test("契约：401 映射 AUTH_FAILED 且不重试", async () => {
  let callCount = 0;
  const fake = await startFakePlatform(() => {
    callCount++;
    return { status: 401, body: { ok: false, error: "请提供有效的 API Key" } };
  });
  try {
    const cfg = loadConfig({
      NSEAP_SERVER_URL: fake.url,
      NSEAP_API_KEY: "bad-key",
      NSEAP_STUDENT_ID: "s001",
    });
    const client = new PlatformClient(cfg);
    const result = await listChallenges(client);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "AUTH_FAILED");
    assert.equal(callCount, 1, "401 不可重试");
  } finally {
    fake.server.close();
  }
});

test("契约：503 映射 BUS_UNAVAILABLE（Agent 通道不降级）", async () => {
  const fake = await startFakePlatform(() => ({
    status: 503,
    body: { ok: false, error: "消息总线不可用" },
  }));
  try {
    const cfg = loadConfig({
      NSEAP_SERVER_URL: fake.url,
      NSEAP_API_KEY: "k",
      NSEAP_STUDENT_ID: "s001",
    });
    const client = new PlatformClient(cfg);
    const result = await submitProject(
      client,
      { studentId: "s001", challengeId: "c", githubRepoUrl: "https://github.com/x/y", projectTitle: "t", aarText: "AAR 内容测试", selfEvaluationText: "自评内容测试", isPublic: true },
      null,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "BUS_UNAVAILABLE");
  } finally {
    fake.server.close();
  }
});

test("契约：tasks/:id 响应解析与平台一致", async () => {
  const fake = await startFakePlatform((req) => {
    if (req.url?.startsWith("/api/tasks/")) {
      return {
        status: 200,
        body: { ok: true, task: { task_id: "t1", status: "completed", result: { ok: true, submissionId: "sub-1" } } },
      };
    }
    return { status: 404, body: { ok: false } };
  });
  try {
    const cfg = loadConfig({ NSEAP_SERVER_URL: fake.url, NSEAP_API_KEY: "k", NSEAP_STUDENT_ID: "s001" });
    const client = new PlatformClient(cfg);
    const result = await getTask(client, "t1");
    assert.equal(result.ok, true);
    assert.equal(result.status, "completed");
    assert.equal(result.result?.submissionId, "sub-1");
  } finally {
    fake.server.close();
  }
});

test("契约：peer 评审请求字段与平台 /api/evaluations 期望一致", async () => {
  const fake = await startFakePlatform((req, body) => {
    if (req.url === "/api/evaluations") {
      const b = body as Record<string, unknown>;
      if (!b.submissionId || b.score === undefined || !b.feedback) {
        return { status: 400, body: { ok: false, error: "缺少必填项：submissionId, score, feedback" } };
      }
      return { status: 200, body: { ok: true, evaluationId: "eval-1", message: "同伴评审已提交" } };
    }
    return { status: 404, body: { ok: false } };
  });
  try {
    const cfg = loadConfig({ NSEAP_SERVER_URL: fake.url, NSEAP_API_KEY: "k", NSEAP_STUDENT_ID: "s001" });
    const client = new PlatformClient(cfg);
    const result = await submitPeerReview(client, {
      submissionId: "sub-9",
      score: 80,
      feedback: "代码结构清晰，建议补充错误处理",
    });
    assert.equal(result.ok, true);
    assert.equal(result.evaluationId, "eval-1");

    const req = fake.requests.find((r) => r.url === "/api/evaluations");
    const body = req?.body as Record<string, unknown>;
    assert.equal(body.evaluator_type, "peer");
    assert.equal(body.submissionId, "sub-9");
    assert.equal(body.score, 80);
  } finally {
    fake.server.close();
  }
});
