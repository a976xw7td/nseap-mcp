/**
 * 本地交付物检查（T4）—— 纯本地 glob 通配符匹配，离线可用
 *
 * 规则（对齐 NSEAP 平台 workflow.ts 的完整性检查逻辑）：
 * - required_deliverables 支持逗号/顿号/换行分隔，支持 * 通配符
 * - pattern 转正则：* → .*，? → .，其余字符转义
 * - 匹配对象是相对 workdir 的文件路径
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface DeliverableCheck {
  ok: boolean;
  missing: string[];
  found: string[];
  patterns: string[];
  totalFiles: number;
  checkedAt: string;
}

/** 把 "README.md, src/**, reflection.md" 拆成 pattern 数组（支持逗号/中文逗号/顿号/换行分隔） */
export function parsePatterns(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，、\n]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** pattern → 正则（与平台 workflow.ts 相同的语义） */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const globbed = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${globbed}$`, "i");
}

/** 递归列出目录下所有文件相对路径（忽略 .git / node_modules） */
export function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  const IGNORED = new Set([".git", "node_modules", ".DS_Store", "dist", "build"]);

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue; // 无权限/不存在 → 跳过
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        out.push(path.relative(dir, full));
      }
    }
  }
  return out;
}

/**
 * 生成本地提交预检报告（nseap_prepare_submission）
 * 在正式提交前给模型/用户一份"还差什么"的完整清单。
 */
export function prepareSubmissionReport(
  workdir: string,
  requiredDeliverables: string | null | undefined,
  opts?: { githubRepoUrl?: string; projectTitle?: string },
): {
  workdir: string;
  deliverables: DeliverableCheck;
  actionItems: string[];
  ready: boolean;
  submissionDraft?: Record<string, unknown>;
} {
  const deliverables = checkDeliverables(workdir, requiredDeliverables);
  const actionItems: string[] = [];

  for (const p of deliverables.missing) {
    actionItems.push(`补充交付物: ${p}`);
  }
  if (!opts?.githubRepoUrl) {
    actionItems.push("提供 GitHub 仓库地址（githubRepoUrl）");
  }
  if (!opts?.projectTitle) {
    actionItems.push("提供项目名称（projectTitle）");
  }

  const ready = actionItems.length === 0;
  const submissionDraft: Record<string, unknown> = {
    ...(opts?.githubRepoUrl ? { githubRepoUrl: opts.githubRepoUrl } : {}),
    ...(opts?.projectTitle ? { projectTitle: opts.projectTitle } : {}),
    deliverablesStatus: {
      missing: deliverables.missing,
      found: deliverables.found,
      totalFiles: deliverables.totalFiles,
    },
  };

  return { workdir, deliverables, actionItems, ready, submissionDraft };
}
export function checkDeliverables(workdir: string, requiredDeliverables: string | null | undefined): DeliverableCheck {
  const patterns = parsePatterns(requiredDeliverables);
  const files = fs.existsSync(workdir) ? listFilesRecursive(workdir) : [];
  const regexes = patterns.map((p) => ({ pattern: p, regex: patternToRegExp(p) }));

  const missing: string[] = [];
  const found: string[] = [];

  for (const { pattern, regex } of regexes) {
    const hit = files.some((f) => regex.test(f));
    (hit ? found : missing).push(pattern);
  }

  return {
    ok: missing.length === 0,
    missing,
    found,
    patterns,
    totalFiles: files.length,
    checkedAt: new Date().toISOString(),
  };
}
