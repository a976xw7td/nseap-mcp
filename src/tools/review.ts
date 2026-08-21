/**
 * 评审与仪表盘工具（M1）：get_evaluation / get_dashboard / health
 */

import { z } from "zod";
import type { PlatformClient } from "../client.js";

interface EvaluationRaw {
  evaluation_id?: string;
  submission_id?: string;
  student_id?: string;
  challenge_id?: string;
  evaluator_type?: string;
  evaluator_id?: string;
  score_total?: number;
  scores_json?: string;
  strengths?: string;
  weaknesses?: string;
  suggestions?: string;
  feedback?: string;
  created_at?: string;
  pending?: boolean;
  project_title?: string;
  submitter_name?: string;
}

interface EvaluationsResponse {
  ok?: boolean;
  evaluations?: EvaluationRaw[];
}

interface DashboardRaw {
  ok?: boolean;
  studentCount?: number;
  challengeCount?: number;
  submissionCount?: number;
  completedCount?: number;
  pendingReviewCount?: number;
}

export const getEvaluationOutputSchema = {
  ok: z.boolean(),
  evaluation: z
    .object({
      evaluation_id: z.string(),
      submission_id: z.string().optional(),
      evaluator_type: z.string().optional(),
      score_total: z.number().optional(),
      scores_json: z.string().optional(),
      strengths: z.string().optional(),
      weaknesses: z.string().optional(),
      suggestions: z.string().optional(),
      feedback: z.string().optional(),
      created_at: z.string().optional(),
    })
    .optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
};

export const getDashboardOutputSchema = {
  ok: z.boolean(),
  stats: z
    .object({
      studentCount: z.number(),
      challengeCount: z.number(),
      submissionCount: z.number(),
      completedCount: z.number(),
      pendingReviewCount: z.number(),
    })
    .optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
};

export const healthOutputSchema = {
  ok: z.boolean(),
  server: z.string().optional(),
  mode: z.string().optional(),
  latencyMs: z.number().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
};

/** 查询某提交的评审详情（AI/教师/同伴） */
export async function getEvaluation(
  client: PlatformClient,
  opts: { evaluationId?: string; submissionId?: string },
): Promise<z.infer<z.ZodObject<typeof getEvaluationOutputSchema>>> {
  try {
    const qs = opts.evaluationId
      ? `?evaluationId=${encodeURIComponent(opts.evaluationId)}`
      : opts.submissionId
        ? `?submissionId=${encodeURIComponent(opts.submissionId)}`
        : "";
    const resp = await client.get<EvaluationsResponse>(`/api/evaluations${qs}`);
    const list = Array.isArray(resp.evaluations) ? resp.evaluations : [];
    const e = list[0];
    if (!e) return { ok: false, error: { code: "NOT_FOUND", message: "未找到评审记录" } };
    return {
      ok: true,
      evaluation: {
        evaluation_id: e.evaluation_id ?? "",
        ...(e.submission_id ? { submission_id: e.submission_id } : {}),
        ...(e.evaluator_type ? { evaluator_type: e.evaluator_type } : {}),
        ...(typeof e.score_total === "number" ? { score_total: e.score_total } : {}),
        ...(e.scores_json ? { scores_json: e.scores_json } : {}),
        ...(e.strengths ? { strengths: e.strengths } : {}),
        ...(e.weaknesses ? { weaknesses: e.weaknesses } : {}),
        ...(e.suggestions ? { suggestions: e.suggestions } : {}),
        ...(e.feedback ? { feedback: e.feedback } : {}),
        ...(e.created_at ? { created_at: e.created_at } : {}),
      },
    };
  } catch (err) {
    return failTool(err);
  }
}

/** 仪表盘统计（学生视角：我的进度；教师视角：班级统计） */
export async function getDashboard(client: PlatformClient): Promise<z.infer<z.ZodObject<typeof getDashboardOutputSchema>>> {
  try {
    const [subsResp, challengesResp] = await Promise.all([
      client.get<{ submissions?: Array<{ status?: string; task_state?: string }> }>("/api/submissions"),
      client.get<{ challenges?: unknown[] }>("/api/challenges"),
    ]);
    const submissions = Array.isArray(subsResp.submissions) ? subsResp.submissions : [];
    const completed = submissions.filter((s) => s.status === "accepted" || s.task_state === "COMPLETED").length;
    const pendingReview = submissions.filter((s) => (s.status ?? "").includes("review")).length;
    return {
      ok: true,
      stats: {
        studentCount: 1, // 学生视角固定 1；教师视角平台返回全员（M2 扩展）
        challengeCount: Array.isArray(challengesResp.challenges) ? challengesResp.challenges.length : 0,
        submissionCount: submissions.length,
        completedCount: completed,
        pendingReviewCount: pendingReview,
      },
    };
  } catch (err) {
    return failTool(err);
  }
}

/** 连接检查（本地 + 平台） */
export async function checkHealth(client: PlatformClient): Promise<z.infer<z.ZodObject<typeof healthOutputSchema>>> {
  const started = Date.now();
  try {
    const resp = await client.get<{ ok?: boolean }>("/api/health");
    return {
      ok: true,
      server: client.serverUrlForLog(),
      mode: client.modeForLog(),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return { ...failTool(err), latencyMs: Date.now() - started };
  }
}

/** 触发飞书通知（经平台消息总线 notify handler） */
export async function sendNotification(
  client: PlatformClient,
  args: { target: "student_dm" | "class_group"; text: string },
): Promise<{ ok: boolean; task_id?: string; error?: { code: string; message: string } }> {
  try {
    const resp = await client.postEnvelope("notify", "submission-task-agent-001", {
      target: args.target,
      text: args.text,
    });
    return { ok: true, ...(resp.task_id ? { task_id: resp.task_id } : {}) };
  } catch (err) {
    return failTool(err) as { ok: false; error: { code: string; message: string } };
  }
}

function failTool(err: unknown): { ok: false; error: { code: string; message: string } } {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
      ? (err as { code: string }).code
      : "INTERNAL";
  return { ok: false, error: { code, message: msg } };
}
