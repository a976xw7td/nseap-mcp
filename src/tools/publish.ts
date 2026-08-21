/**
 * 教师发布挑战工具（M2）：nseap_publish_challenge
 *
 * 通道纪律：
 * - 教师 Agent 通道走消息总线 challenge_publish（平台信任矩阵：
 *   teacher-companion-workbuddy → submission-task-agent，capabilities 含 challenge_publish）
 * - 身份由平台从 x-api-key 解析（AGENT_API_KEYS 映射），nseap-mcp 不伪造
 * - 工具仅在 NSEAP_ROLE=teacher 配置下暴露（index.ts 按 config.role 裁剪）
 */

import { z } from "zod";
import type { PlatformClient } from "../client.js";

export const publishChallengeOutputSchema = {
  ok: z.boolean(),
  challengeId: z.string().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
};

export interface PublishChallengeArgs {
  title: string;
  brief?: string;
  objective?: string;
  deliverables: string;
  rubric: string;
  requiredDeliverables?: string;
  rubricDimensions?: string;
  deadline: string;
}

/** 发布挑战（经平台消息总线，异步入队） */
export async function publishChallenge(
  client: PlatformClient,
  args: PublishChallengeArgs,
): Promise<z.infer<z.ZodObject<typeof publishChallengeOutputSchema>>> {
  try {
    const resp = await client.postEnvelope("challenge_publish", "submission-task-agent-001", {
      title: args.title,
      ...(args.brief ? { brief: args.brief } : {}),
      ...(args.objective ? { objective: args.objective } : {}),
      deliverables: args.deliverables,
      rubric: args.rubric,
      ...(args.requiredDeliverables ? { required_deliverables: args.requiredDeliverables } : {}),
      ...(args.rubricDimensions ? { rubric_dimensions: args.rubricDimensions } : {}),
      deadline: args.deadline,
    });
    return { ok: true, challengeId: `task:${resp.task_id ?? "-"}` };
  } catch (err) {
    return failPublish(err);
  }
}

function failPublish(err: unknown): { ok: false; error: { code: string; message: string } } {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { code: string; userMessage?: string; message: string };
    return { ok: false, error: { code: e.code, message: e.userMessage ?? e.message } };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, error: { code: "INTERNAL", message: msg } };
}
