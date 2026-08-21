/**
 * 客户端连接模拟测试 —— 用与 CogSeed 完全相同的方式
 * （@modelcontextprotocol/sdk Client + StdioClientTransport）连接 nseap-mcp server，
 * 验证真实 stdio 握手 + tools/list + tools/call 全链路。
 *
 * 这是接入 CogSeed 前的最后一环验证：协议兼容性。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** 以 CogSeed 方式启动 nseap-mcp 子进程并连接 */
async function connectServer(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: process.execPath, // node
    args: ["--import", "tsx", "src/index.ts"],
    env: { ...process.env, ...env },
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client(
    { name: "cogseed-pc", version: "0.1.0" }, // 与 CogSeed 相同的 clientInfo
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

test("CogSeed 方式连接：握手 + 工具列表", async () => {
  const client = await connectServer({
    NSEAP_MOCK: "1",
    NSEAP_STUDENT_ID: "test-student",
  });
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    assert.ok(names.includes("nseap_submit_project"), "缺 submit_project");
    assert.ok(names.includes("nseap_check_deliverables"), "缺 check_deliverables");
    assert.equal(names.includes("nseap_publish_challenge"), false, "student 不应有 publish_challenge");
    console.log(`✅ CogSeed 客户端握手成功，student 工具面 ${names.length} 个`);
  } finally {
    await client.close();
  }
});

test("CogSeed 方式调用：本地交付物检查", async () => {
  const client = await connectServer({
    NSEAP_MOCK: "1",
    NSEAP_STUDENT_ID: "test-student",
  });
  try {
    const result = await client.callTool({
      name: "nseap_check_deliverables",
      arguments: {
        workdir: process.cwd(), // 用项目自身目录（有 README.md + src）
        requiredDeliverables: "README.md, src/**, NOT_EXIST.md",
      },
    });
    const sc = result.structuredContent as Record<string, unknown>;
    assert.equal(sc.ok, false);
    assert.ok(Array.isArray(sc.missing) && (sc.missing as string[]).includes("NOT_EXIST.md"));
    console.log(`✅ CogSeed 方式调用成功：缺失=${JSON.stringify(sc.missing)}`);
  } finally {
    await client.close();
  }
});

test("CogSeed 方式调用：mock 提交闭环", async () => {
  const client = await connectServer({
    NSEAP_MOCK: "1",
    NSEAP_STUDENT_ID: "test-student",
  });
  try {
    const submit = await client.callTool({
      name: "nseap_submit_project",
      arguments: {
        challengeId: "ch-mock-c03",
        githubRepoUrl: "https://github.com/test/repo",
        projectTitle: "客户端模拟测试",
        aarText: "AAR 复盘内容测试，包含完整方法论总结",
        selfEvaluationText: "自评内容测试，对项目完整评估",
        isPublic: true,
      },
    });
    const sc = submit.structuredContent as Record<string, unknown>;
    assert.equal(sc.ok, true);
    assert.ok(typeof sc.task_id === "string");

    // 轮询
    const task = await client.callTool({
      name: "nseap_get_task",
      arguments: { taskId: sc.task_id },
    });
    const tc = task.structuredContent as Record<string, unknown>;
    assert.equal(tc.status, "completed");
    console.log(`✅ 提交→轮询闭环：task=${sc.task_id} → ${tc.status}`);
  } finally {
    await client.close();
  }
});
