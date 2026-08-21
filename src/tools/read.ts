/**
 * 只读工具（T3）：挑战查询 / 提交列表 / 任务状态
 *
 * 返回精简结构（对齐 docs/design/10-MCP工具Schema.md §一 工具 1/2/6/7）
 */

import { z } from "zod";
import type { PlatformClient } from "../client.js";

// ---- 平台返回类型（宽松声明，运行时只取需要的字段） ----

interface ChallengeRaw {
  challenge_id?: string;
  title?: string;
  brief?: string;
  objective?: string;
  deliverables?: string;
  rubric?: string;
  rubric_dimensions?: string;
  red_flags?: string;
  required_deliverables?: string;
  deadline?: string;
  status?: string;
}

interface ChallengesResponse {
  ok?: boolean;
  challenges?: ChallengeRaw[];
}

interface SubmissionRaw {
  submission_id?: string;
  challenge_id?: string;
  project_title?: string;
  github_repo_url?: string;
  status?: string;
  task_state?: string;
  submitted_at?: string;
}

interface SubmissionsResponse {
  ok?: boolean;
  submissions?: SubmissionRaw[];
}

interface TaskRaw {
  task_id?: string;
  status?: string;
  result?: { ok?: boolean; submissionId?: string; evaluationId?: string; error?: string };
}

interface TaskResponse {
  ok?: boolean;
  task?: TaskRaw;
}

// ---- 输出 schema（MCP 工具返回） ----

export const listChallengesOutputSchema = {
  ok: z.boolean(),
  challenges: z.array(
    z.object({
      challenge_id: z.string(),
      title: z.string(),
      status: z.string(),
      deadline: z.string().optional(),
      required_deliverables: z.string().optional(),
    }),
  ),
  error: z
    .object({ code: z.string(), message: z.string() })
    .optional(),
};

export const getChallengeOutputSchema = {
  ok: z.boolean(),
  challenge: z
    .object({
      challenge_id: z.string(),
      title: z.string(),
      brief: z.string().optional(),
      objective: z.string().optional(),
      deliverables: z.string().optional(),
      rubric: z.string().optional(),
      rubric_dimensions: z.string().optional(),
      red_flags: z.string().optional(),
      required_deliverables: z.string().optional(),
      deadline: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  error: z
    .object({ code: z.string(), message: z.string() })
    .optional(),
};

export const getTaskOutputSchema = {
  ok: z.boolean(),
  status: z.string().optional(),
  result: z
    .object({
      submissionId: z.string().optional(),
      evaluationId: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
  error: z
    .object({ code: z.string(), message: z.string() })
    .optional(),
};

export const listMySubmissionsOutputSchema = {
  ok: z.boolean(),
  submissions: z.array(
    z.object({
      submission_id: z.string(),
      challenge_id: z.string().optional(),
      project_title: z.string().optional(),
      github_repo_url: z.string().optional(),
      status: z.string().optional(),
      task_state: z.string().optional(),
      submitted_at: z.string().optional(),
    }),
  ),
  error: z
    .object({ code: z.string(), message: z.string() })
    .optional(),
};

// ---- 业务函数 ----

export async function listChallenges(client: PlatformClient): Promise<z.infer<z.ZodObject<typeof listChallengesOutputSchema>>> {
  try {
    const resp = await client.get<ChallengesResponse>("/api/challenges");
    const list = Array.isArray(resp.challenges) ? resp.challenges : [];
    return {
      ok: true,
      challenges: list.map((c) => ({
        challenge_id: c.challenge_id ?? "",
        title: c.title ?? "",
        status: c.status ?? "",
        ...(c.deadline ? { deadline: c.deadline } : {}),
        ...(c.required_deliverables ? { required_deliverables: c.required_deliverables } : {}),
      })),
    };
  } catch (err) {
    return { ...failRead(err), challenges: [] };
  }
}

export async function getChallenge(client: PlatformClient, challengeId: string): Promise<z.infer<z.ZodObject<typeof getChallengeOutputSchema>>> {
  try {
    const resp = await client.get<ChallengesResponse>("/api/challenges");
    const c = (Array.isArray(resp.challenges) ? resp.challenges : []).find(
      (x) => x.challenge_id === challengeId,
    );
    if (!c) return { ok: false, error: { code: "NOT_FOUND", message: "挑战不存在" } };
    return {
      ok: true,
      challenge: {
        challenge_id: c.challenge_id ?? challengeId,
        title: c.title ?? "",
        ...(c.brief ? { brief: c.brief } : {}),
        ...(c.objective ? { objective: c.objective } : {}),
        ...(c.deliverables ? { deliverables: c.deliverables } : {}),
        ...(c.rubric ? { rubric: c.rubric } : {}),
        ...(c.rubric_dimensions ? { rubric_dimensions: c.rubric_dimensions } : {}),
        ...(c.red_flags ? { red_flags: c.red_flags } : {}),
        ...(c.required_deliverables ? { required_deliverables: c.required_deliverables } : {}),
        ...(c.deadline ? { deadline: c.deadline } : {}),
        ...(c.status ? { status: c.status } : {}),
      },
    };
  } catch (err) {
    return failRead(err);
  }
}

export async function getTask(client: PlatformClient, taskId: string): Promise<z.infer<z.ZodObject<typeof getTaskOutputSchema>>> {
  try {
    const resp = await client.get<TaskResponse>(`/api/tasks/${encodeURIComponent(taskId)}`);
    const t = resp.task;
    if (!t) return { ok: false, error: { code: "NOT_FOUND", message: "任务不存在或已过期" } };
    return {
      ok: true,
      status: t.status ?? "unknown",
      ...(t.result ? { result: { ...(t.result.submissionId ? { submissionId: t.result.submissionId } : {}), ...(t.result.evaluationId ? { evaluationId: t.result.evaluationId } : {}), ...(t.result.error ? { error: t.result.error } : {}) } } : {}),
    };
  } catch (err) {
    return failRead(err);
  }
}

export async function listMySubmissions(client: PlatformClient): Promise<z.infer<z.ZodObject<typeof listMySubmissionsOutputSchema>>> {
  try {
    const resp = await client.get<SubmissionsResponse>("/api/submissions");
    const list = Array.isArray(resp.submissions) ? resp.submissions : [];
    return {
      ok: true,
      submissions: list.map((s) => ({
        submission_id: s.submission_id ?? "",
        ...(s.challenge_id ? { challenge_id: s.challenge_id } : {}),
        ...(s.project_title ? { project_title: s.project_title } : {}),
        ...(s.github_repo_url ? { github_repo_url: s.github_repo_url } : {}),
        ...(s.status ? { status: s.status } : {}),
        ...(s.task_state ? { task_state: s.task_state } : {}),
        ...(s.submitted_at ? { submitted_at: s.submitted_at } : {}),
      })),
    };
  } catch (err) {
    return { ...failRead(err), submissions: [] };
  }
}

function failRead(err: unknown): { ok: false; error: { code: string; message: string } } {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
      ? (err as { code: string }).code
      : "INTERNAL";
  return { ok: false, error: { code, message: msg } } as { ok: false; error: { code: string; message: string } } & Record<string, unknown>;
}
