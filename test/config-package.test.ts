/**
 * CogSeed 配置包自检（质量门）
 *
 * 验证 cogseed-config/aix-workspace/ 的：
 * 1. JSON 格式合法（agent.json / connector 模板）
 * 2. SKILL.md 引用的工具名与 nseap-mcp 实际工具面一致（防断链）
 * 3. 文件结构完整
 *
 * 运行：node --test test/config-package.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const PKG = path.resolve(import.meta.dirname, "../cogseed-config/aix-workspace");

/** 提取 SKILL.md / agent.json 中引用的所有 nseap_* 工具名 */
function extractToolRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/\b(nseap_[a-z_]+)\b/g)) {
    refs.add(m[1]);
  }
  return [...refs];
}

/** 期望的工具面（student 12 + teacher 1） */
const EXPECTED_TOOLS = [
  "nseap_check_deliverables",
  "nseap_prepare_submission",
  "nseap_list_challenges",
  "nseap_get_challenge",
  "nseap_list_my_submissions",
  "nseap_get_task",
  "nseap_submit_project",
  "nseap_get_evaluation",
  "nseap_submit_review",
  "nseap_get_dashboard",
  "nseap_notify",
  "nseap_health",
  "nseap_publish_challenge",
];

test("配置包结构完整", () => {
  assert.ok(fs.existsSync(path.join(PKG, "README.md")), "缺 README");
  assert.ok(fs.existsSync(path.join(PKG, "agents/aix-nseap-companion.json")), "缺 Agent");
  assert.ok(fs.existsSync(path.join(PKG, "skills/nseap-submit/SKILL.md")), "缺 SKILL.md");
  assert.ok(fs.existsSync(path.join(PKG, "connectors/nseap-platform.json")), "缺连接器模板");
});

test("agent.json 是合法 JSON 且含必要字段", () => {
  const raw = fs.readFileSync(path.join(PKG, "agents/aix-nseap-companion.json"), "utf-8");
  const agent = JSON.parse(raw) as Record<string, unknown>;
  assert.ok(agent.agent_id, "缺 agent_id");
  assert.ok(agent.name, "缺 name");
  assert.ok(agent.workflow, "缺 workflow");
  assert.ok(Array.isArray(agent.skill_list), "缺 skill_list");
});

test("连接器模板 JSON 合法且 stdio 字段齐全", () => {
  const raw = fs.readFileSync(path.join(PKG, "connectors/nseap-platform.json"), "utf-8");
  const conn = JSON.parse(raw) as { transport?: Record<string, unknown> };
  assert.equal(conn.transport?.kind, "stdio");
  assert.ok(conn.transport?.command, "缺 command");
  assert.ok(Array.isArray(conn.transport?.args), "缺 args");
  assert.ok(conn.transport?.env && typeof conn.transport.env === "object", "缺 env");
});

test("SKILL.md 引用的工具全部存在（防断链）", () => {
  const skill = fs.readFileSync(path.join(PKG, "skills/nseap-submit/SKILL.md"), "utf-8");
  const agent = fs.readFileSync(path.join(PKG, "agents/aix-nseap-companion.json"), "utf-8");
  const refs = [...extractToolRefs(skill), ...extractToolRefs(agent)];
  assert.ok(refs.length >= 6, `引用工具太少（${refs.length}）`);
  const unknown = refs.filter((r) => !EXPECTED_TOOLS.includes(r));
  assert.deepEqual(unknown, [], `引用了不存在的工具: ${unknown.join(", ")}`);
  console.log(`✅ SKILL/Agent 引用工具 ${refs.length} 个，全部有效`);
});

test("SKILL.md 含关键流程步骤", () => {
  const skill = fs.readFileSync(path.join(PKG, "skills/nseap-submit/SKILL.md"), "utf-8");
  for (const keyword of ["预检", "提交", "轮询", "AAR", "停止规则"]) {
    assert.ok(skill.includes(keyword), `SKILL.md 缺关键词: ${keyword}`);
  }
});

test("agent workflow 含失败行为约束", () => {
  const raw = fs.readFileSync(path.join(PKG, "agents/aix-nseap-companion.json"), "utf-8");
  const agent = JSON.parse(raw) as { workflow?: string };
  assert.ok(agent.workflow?.includes("never_invent_submission_content"), "缺反幻觉约束");
  assert.ok(agent.workflow?.includes("never_skip_local_check"), "缺预检强制约束");
});
