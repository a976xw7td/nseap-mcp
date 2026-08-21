/**
 * 提交工具（T5）—— 核心闭环
 *
 * 流程：本地预检（可选，快速失败）→ postEnvelope 提交平台消息总线 → 返回 task_id
 * 架构红线：
 * - from_agent 固定为 student-companion-<学号>（不接受参数伪造）
 * - Agent 通道提交必须经消息总线（平台强制，503 不降级）
 * - 长耗时一律 submit→task_id→轮询（不阻塞 MCP 工具调用）
 */

import { z } from "zod";
import type { PlatformClient } from "../client.js";
import { checkDeliverables } from "./local.js";

export const reviewModeSchema = z.enum(["teacher_only", "peer_only", "teacher_and_peer", "handoff"]).optional();

export const submitProjectOutputSchema = {
  ok: z.boolean(),
  task_id: z.string().optional(),
  status: z.string().optional(),
  localIssues: z
    .array(
      z.object({
        pattern: z.string(),
        found: z.boolean(),
        message: z.string(),
      }),
    )
    .optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
};

export interface SubmitArgs {
  /** 学生学号（从配置注入，平台侧 enforcedStudentId 二次校验） */
  studentId?: string;
  challengeId: string;
  githubRepoUrl: string;
  projectTitle: string;
  projectSummary?: string;
  aarText: string;
  selfEvaluationText: string;
  isPublic: boolean;
  reviewMode?: z.infer<typeof reviewModeSchema>;
  /** 本地项目目录（可选，提供则先跑本地预检） */
  workdir?: string;
  /** 预检不通过时是否阻塞提交（默认 true：缺交付物直接拦截） */
  blockOnMissing?: boolean;
}

export interface SubmitResult {
  ok: boolean;
  task_id?: string;
  status?: string;
  localIssues?: Array<{ pattern: string; found: boolean; message: string }>;
  error?: { code: string; message: string };
}

/**
 * 提交项目。
 * 1) 若提供 workdir 且挑战有 required_deliverables → 本地预检（离线，不花 AI 钱）
 * 2) 缺交付物且 blockOnMissing → 直接返回失败（不消耗平台资源）
 * 3) 构造 Envelope → POST /api/hermes → task_id
 */
export async function submitProject(
  client: PlatformClient,
  args: SubmitArgs,
  challengeRequiredDeliverables?: string | null,
): Promise<SubmitResult> {
  // 本地预检（可选）
  let localIssues: SubmitResult["localIssues"];
  if (args.workdir && challengeRequiredDeliverables) {
    const check = checkDeliverables(args.workdir, challengeRequiredDeliverables);
    localIssues = check.patterns.map((p) => ({
      pattern: p,
      found: check.found.includes(p),
      message: check.found.includes(p) ? "存在" : "缺失",
    }));
    if (!check.ok && args.blockOnMissing !== false) {
      return {
        ok: false,
        localIssues,
        error: {
          code: "BAD_REQUEST",
          message: `缺少交付物: ${check.missing.join("、")}。请补充后重新提交。`,
        },
      };
    }
  }

  try {
    const resp = await client.postEnvelope("submission_request", "submission-task-agent-001", {
      studentId: args.studentId,
      challengeId: args.challengeId,
      projectTitle: args.projectTitle,
      projectSummary: args.projectSummary ?? "",
      githubRepoUrl: args.githubRepoUrl,
      aarText: args.aarText,
      selfEvaluationText: args.selfEvaluationText,
      isPublic: args.isPublic,
      ...(args.reviewMode ? { reviewMode: args.reviewMode } : {}),
    });
    return {
      ok: true,
      ...(resp.task_id ? { task_id: resp.task_id } : {}),
      status: "pending",
      ...(localIssues ? { localIssues } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      ...(localIssues ? { localIssues } : {}),
      error: toToolError(err),
    };
  }
}

function toToolError(err: unknown): { code: string; message: string } {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { code: string; userMessage?: string; message: string };
    return { code: e.code, message: e.userMessage ?? e.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { code: "INTERNAL", message: msg };
}
