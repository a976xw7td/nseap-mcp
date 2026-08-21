/**
 * 配置加载 + 错误码单元测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig, ConfigError, maskKey, fromAgentOf } from "../src/config.js";
import { NseapError, httpStatusToCode } from "../src/errors.js";

test("loadConfig 缺失必需变量时抛 ConfigError", () => {
  assert.throws(() => loadConfig({}), ConfigError);
});

test("loadConfig mock 模式可缺 api_key", () => {
  const cfg = loadConfig({
    NSEAP_MOCK: "1",
    NSEAP_STUDENT_ID: "s001",
  });
  assert.equal(cfg.mock, true);
  assert.equal(cfg.serverUrl, "http://49.233.169.16"); // 默认值
  assert.equal(cfg.role, "student");
});

test("loadConfig 读取完整配置", () => {
  const cfg = loadConfig({
    NSEAP_SERVER_URL: "http://localhost:3000/",
    NSEAP_API_KEY: "sk-test",
    NSEAP_STUDENT_ID: "s001",
    NSEAP_COHORT: "elite20",
    NSEAP_ROLE: "teacher",
  });
  assert.equal(cfg.serverUrl, "http://localhost:3000"); // 去尾斜杠
  assert.equal(cfg.apiKey, "sk-test");
  assert.equal(cfg.studentId, "s001");
  assert.equal(cfg.cohort, "elite20");
  assert.equal(cfg.role, "teacher");
});

test("maskKey 脱敏", () => {
  assert.equal(maskKey(""), "<empty>");
  assert.equal(maskKey("short"), "****");
  const m = maskKey("abcdefgh1234");
  assert.equal(m, "abcd****1234");
  assert.ok(!m.includes("efgh"));
});

test("fromAgentOf 固定学生身份", () => {
  const cfg = loadConfig({ NSEAP_MOCK: "1", NSEAP_STUDENT_ID: "zhanghao" });
  assert.equal(fromAgentOf(cfg), "student-companion-zhanghao");
});

test("httpStatusToCode 映射", () => {
  assert.equal(httpStatusToCode(401), "AUTH_FAILED");
  assert.equal(httpStatusToCode(403), "FORBIDDEN");
  assert.equal(httpStatusToCode(404), "NOT_FOUND");
  assert.equal(httpStatusToCode(409), "CONFLICT");
  assert.equal(httpStatusToCode(503), "BUS_UNAVAILABLE");
  assert.equal(httpStatusToCode(500), "INTERNAL");
});

test("NseapError 用户可读消息", () => {
  const e = new NseapError("AUTH_FAILED");
  assert.equal(e.userMessage.includes("api_key"), true);
  assert.equal(e.code, "AUTH_FAILED");
});
