/**
 * 评审提交工具（M2）：nseap_submit_review
 *
 * 通道纪律（继承平台约束）：
 * - peer 评审：POST /api/evaluations（evaluator_type=peer，平台校验分配关系，防未分配评审）
 * - teacher 评审：Agent 通道必须走消息总线 manual_review_adjustment（平台强制，不降级）
 */

import { z } from "zod";
import type { PlatformClient } from "../client.js";

export const submitReviewOutputSchema = {
  ok: z.boolean(),
  evaluationId: z.string().optional(),
  message: z.string().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
};

export interface SubmitReviewArgs {
  evaluatorType: "peer" | "teacher";
  submissionId: string;
  score: number;
  feedback: string;
  /** teacher 终审动作（accept/return），仅 evaluatorType=teacher 时有效 */
  action?: "accept" | "return";
  /** teacher 评审需平台飞书记录 ID（recordId），peer 不需要 */
  submissionRecordId?: string;
}

interface ApiResult {
  ok?: boolean;
  evaluationId?: string;
  message?: string;
  error?: string;
}

/** 同伴评审（平台校验：只能评被分配的提交） */
export async function submitPeerReview(
  client: PlatformClient,
  args: { submissionId: string; score: number; feedback: string },
): Promise<z.infer<z.ZodObject<typeof submitReviewOutputSchema>>> {
  try {
    const resp = await client.post<ApiResult>("/api/evaluations", {
      evaluator_type: "peer",
      submissionId: args.submissionId,
      score: args.score,
      feedback: args.feedback,
    });
    if (!resp.ok) {
      return { ok: false, error: { code: "BAD_REQUEST", message: resp.error ?? "评审提交失败" } };
    }
    return { ok: true, evaluationId: resp.evaluationId, message: resp.message ?? "同伴评审已提交" };
  } catch (err) {
    return failReview(err);
  }
}

/** 教师终审（Agent 通道必须走消息总线） */
export async function submitTeacherReview(
  client: PlatformClient,
  args: { submissionId: string; submissionRecordId: string; action: "accept" | "return"; score: number; feedback: string },
): Promise<z.infer<z.ZodObject<typeof submitReviewOutputSchema>>> {
  try {
    const resp = await client.postEnvelope("manual_review_adjustment", "submission-task-agent-001", {
      submissionId: args.submissionId,
      submissionRecordId: args.submissionRecordId,
      action: args.action,
      score: args.score,
      feedback: args.feedback,
    });
    return { ok: true, message: `教师终审已入队（task: ${resp.task_id ?? "-"}），飞书将通知学生` };
  } catch (err) {
    return failReview(err);
  }
}

/** 统一入口 */
export async function submitReview(
  client: PlatformClient,
  args: SubmitReviewArgs,
): Promise<z.infer<z.ZodObject<typeof submitReviewOutputSchema>>> {
  if (args.evaluatorType === "peer") {
    return submitPeerReview(client, {
      submissionId: args.submissionId,
      score: args.score,
      feedback: args.feedback,
    });
  }
  if (args.action === undefined) {
    return { ok: false, error: { code: "BAD_REQUEST", message: "教师终审必须提供 action（accept/return）" } };
  }
  if (args.submissionRecordId === undefined) {
    return { ok: false, error: { code: "BAD_REQUEST", message: "教师终审必须提供 submissionRecordId（飞书记录 ID）" } };
  }
  return submitTeacherReview(client, {
    submissionId: args.submissionId,
    submissionRecordId: args.submissionRecordId,
    action: args.action,
    score: args.score,
    feedback: args.feedback,
  });
}

function failReview(err: unknown): { ok: false; error: { code: string; message: string } } {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { code: string; userMessage?: string; message: string };
    return { ok: false, error: { code: e.code, message: e.userMessage ?? e.message } };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, error: { code: "INTERNAL", message: msg } };
}
