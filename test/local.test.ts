/**
 * 本地交付物检查单元测试（node:test）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parsePatterns, patternToRegExp, checkDeliverables, listFilesRecursive, prepareSubmissionReport } from "../src/tools/local.js";

test("parsePatterns 支持逗号/顿号/换行分隔", () => {
  assert.deepEqual(parsePatterns("README.md, src/**, reflection.md"), ["README.md", "src/**", "reflection.md"]);
  assert.deepEqual(parsePatterns("a、b\nc"), ["a", "b", "c"]);
  assert.deepEqual(parsePatterns(""), []);
  assert.deepEqual(parsePatterns(null), []);
});

test("patternToRegExp 与平台 workflow.ts 语义一致", () => {
  const re = patternToRegExp("src/**");
  assert.ok(re.test("src/main.py"));
  assert.ok(re.test("src/utils/helper.ts"));
  assert.ok(!re.test("README.md"));

  // 特殊字符转义
  const re2 = patternToRegExp("file.md");
  assert.ok(re2.test("file.md"));
  assert.ok(!re2.test("fileXmd"));

  // 通配符 ? 
  const re3 = patternToRegExp("test?.md");
  assert.ok(re3.test("test1.md"));
  assert.ok(!re3.test("test12.md"));
});

test("checkDeliverables 在临时目录中正确检查", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nseap-test-"));
  try {
    fs.writeFileSync(path.join(dir, "README.md"), "# test");
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "main.py"), "print('hi')");

    const result = checkDeliverables(dir, "README.md, src/**, reflection.md");
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ["reflection.md"]);
    assert.deepEqual(result.found.sort(), ["README.md", "src/**"]);
    assert.equal(result.totalFiles, 2);

    // 补上缺失文件后通过
    fs.writeFileSync(path.join(dir, "reflection.md"), "AAR");
    const result2 = checkDeliverables(dir, "README.md, src/**, reflection.md");
    assert.equal(result2.ok, true);
    assert.equal(result2.missing.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkDeliverables 目录不存在时全部缺失", () => {
  const result = checkDeliverables("/nonexistent/path/xyz", "README.md");
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["README.md"]);
  assert.equal(result.totalFiles, 0);
});

test("listFilesRecursive 忽略 .git 和 node_modules", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nseap-test-"));
  try {
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref");
    fs.writeFileSync(path.join(dir, "node_modules", "x.js"), "");
    fs.writeFileSync(path.join(dir, "keep.txt"), "");

    const files = listFilesRecursive(dir);
    assert.deepEqual(files, ["keep.txt"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareSubmissionReport 生成行动项清单", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nseap-test-"));
  try {
    fs.writeFileSync(path.join(dir, "README.md"), "# x");
    // 缺 reflection.md + 无 repo + 无标题 → 3 个行动项
    const report = prepareSubmissionReport(dir, "README.md, reflection.md");
    assert.equal(report.ready, false);
    assert.ok(report.actionItems.includes("补充交付物: reflection.md"));
    assert.ok(report.actionItems.includes("提供 GitHub 仓库地址（githubRepoUrl）"));
    assert.ok(report.actionItems.includes("提供项目名称（projectTitle）"));

    // 齐全后 ready
    const report2 = prepareSubmissionReport(dir, "README.md", {
      githubRepoUrl: "https://github.com/x/y",
      projectTitle: "t",
    });
    assert.equal(report2.ready, true);
    assert.equal(report2.actionItems.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
