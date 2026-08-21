/**
 * nseap-mcp 主入口 —— stdio MCP Server
 *
 * 接入方式（CogSeed 最新版 bonc-ai/cogseed）：
 *   自定义连接器 connectors.add_custom，transport=stdio：
 *     command: npx tsx <本文件>  (M1 起用 bun build 单文件)
 *     env:     NSEAP_SERVER_URL / NSEAP_API_KEY / NSEAP_STUDENT_ID / NSEAP_COHORT / NSEAP_ROLE
 *
 * 工具面（对齐 docs/design/10-MCP工具Schema.md）：
 *   本地（离线·非权威）：nseap_check_deliverables
 *   平台（权威·可审计）：nseap_list_challenges / nseap_get_challenge /
 *                       nseap_list_my_submissions / nseap_get_task /
 *                       nseap_submit_project
 *
 * 纪律：
 *   - 工具返回结构化对象，不抛错（抛错会中断模型工具循环）
 *   - api_key 只在 client 内部使用，日志永远脱敏
 *   - from_agent 固定为配置值，不接受工具参数伪造
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig, ConfigError, maskKey } from "./config.js";
import { PlatformClient } from "./client.js";
import { checkDeliverables, prepareSubmissionReport } from "./tools/local.js";
import {
  listChallenges,
  getChallenge,
  getTask,
  listMySubmissions,
} from "./tools/read.js";
import { submitProject, reviewModeSchema } from "./tools/submit.js";
import { getEvaluation, getDashboard, checkHealth, sendNotification } from "./tools/review.js";
import { submitReview } from "./tools/review-submit.js";
import { publishChallenge } from "./tools/publish.js";

// ---- 启动 ----

/** 把业务结果转成 MCP 工具返回（text 供展示 + structuredContent 供程序消费） */
function toolResponse(result: unknown): { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> } {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result as Record<string, unknown>,
  };
}

function buildServer() {
  const config = loadConfig();
  const client = new PlatformClient(config);

  const server = new McpServer({
    name: "nseap-platform",
    version: "0.1.0",
  });

  // ---- 本地工具（离线可用，非权威） ----

  server.registerTool(
    "nseap_check_deliverables",
    {
      title: "本地交付物检查",
      description:
        "按挑战的 required_deliverables（支持 * 通配符）在本地工作区检查文件是否齐全。离线可用，结果非权威（平台提交时仍会复检）。",
      inputSchema: {
        workdir: z.string().describe("本地项目目录（绝对路径）"),
        requiredDeliverables: z
          .string()
          .describe("挑战定义的交付物 pattern（逗号分隔，支持 * 通配符），如 README.md, src/**, reflection.md"),
      },
      outputSchema: {
        ok: z.boolean(),
        missing: z.array(z.string()),
        found: z.array(z.string()),
        patterns: z.array(z.string()),
        totalFiles: z.number(),
        checkedAt: z.string(),
      },
    },
    async (args) => {
      const result = checkDeliverables(args.workdir, args.requiredDeliverables);
      return toolResponse(result);
    },
  );

  server.registerTool(
    "nseap_prepare_submission",
    {
      title: "生成本地提交预检报告",
      description:
        "在正式提交前生成完整预检清单：交付物完整性 + 待办行动项 + 提交草稿。离线可用，结果非权威。",
      inputSchema: {
        workdir: z.string().describe("本地项目目录（绝对路径）"),
        requiredDeliverables: z
          .string()
          .describe("挑战定义的交付物 pattern（逗号分隔，支持 * 通配符）"),
        githubRepoUrl: z.string().url().optional().describe("GitHub 仓库地址（可选）"),
        projectTitle: z.string().optional().describe("项目名称（可选）"),
      },
      outputSchema: {
        workdir: z.string(),
        deliverables: z.object({
          ok: z.boolean(),
          missing: z.array(z.string()),
          found: z.array(z.string()),
          patterns: z.array(z.string()),
          totalFiles: z.number(),
          checkedAt: z.string(),
        }),
        actionItems: z.array(z.string()),
        ready: z.boolean(),
        submissionDraft: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => {
      const result = prepareSubmissionReport(args.workdir, args.requiredDeliverables, {
        ...(args.githubRepoUrl !== undefined ? { githubRepoUrl: args.githubRepoUrl } : {}),
        ...(args.projectTitle !== undefined ? { projectTitle: args.projectTitle } : {}),
      });
      return toolResponse(result);
    },
  );

  // ---- 只读工具（平台） ----

  server.registerTool(
    "nseap_list_challenges",
    {
      title: "查询已发布挑战",
      description: "从 NSEAP 平台查询当前已发布的挑战（含交付物要求与截止时间）。",
      inputSchema: {},
      outputSchema: {
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
        error: z.object({ code: z.string(), message: z.string() }).optional(),
      },
    },
    async () => {
      const result = await listChallenges(client);
      return toolResponse(result);
    },
  );

  server.registerTool(
    "nseap_get_challenge",
    {
      title: "查询挑战详情",
      description: "获取单个挑战的完整详情（交付物/rubric/评分维度/红线规则/截止时间）。",
      inputSchema: {
        challengeId: z.string().describe("挑战 ID，如 ch-xxx 或 C03"),
      },
      outputSchema: {
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
        error: z.object({ code: z.string(), message: z.string() }).optional(),
      },
    },
    async (args) => {
      const result = await getChallenge(client, args.challengeId);
      return toolResponse(result);
    },
  );

  server.registerTool(
    "nseap_list_my_submissions",
    {
      title: "查询我的提交",
      description: "查询当前学生的提交记录列表（平台按 x-api-key 绑定身份，只返回自己的数据）。",
      inputSchema: {},
      outputSchema: {
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
        error: z.object({ code: z.string(), message: z.string() }).optional(),
      },
    },
    async () => {
      const result = await listMySubmissions(client);
      return toolResponse(result);
    },
  );

  server.registerTool(
    "nseap_get_task",
    {
      title: "查询异步任务状态",
      description:
        "按 task_id 轮询提交任务状态（pending/processing/completed/failed）。提交是异步的：先用 nseap_submit_project 拿到 task_id，再用本工具轮询结果。",
      inputSchema: {
        taskId: z.string().describe("nseap_submit_project 返回的 task_id"),
      },
      outputSchema: {
        ok: z.boolean(),
        status: z.string().optional(),
        result: z
          .object({
            submissionId: z.string().optional(),
            evaluationId: z.string().optional(),
            error: z.string().optional(),
          })
          .optional(),
        error: z.object({ code: z.string(), message: z.string() }).optional(),
      },
    },
    async (args) => {
      const result = await getTask(client, args.taskId);
      return toolResponse(result);
    },
  );

  // ---- 评审/仪表盘/健康工具（M1） ----

  server.registerTool(
    "nseap_get_evaluation",
    {
      title: "查询评审详情",
      description: "查询某提交的评审详情（AI 初评/教师终审/同伴评审），含分项分数与优缺点建议。",
      inputSchema: {
        evaluationId: z.string().optional().describe("评价 ID"),
        submissionId: z.string().optional().describe("提交 ID（与 evaluationId 二选一）"),
      },
      outputSchema: {
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
      },
    },
    async (args) => {
      const result = await getEvaluation(client, {
        ...(args.evaluationId !== undefined ? { evaluationId: args.evaluationId } : {}),
        ...(args.submissionId !== undefined ? { submissionId: args.submissionId } : {}),
      });
      return toolResponse(result);
    },
  );

  server.registerTool(
    "nseap_get_dashboard",
    {
      title: "查询仪表盘统计",
      description: "查询当前学生的进度统计（挑战数/提交数/完成数/待评审数）。",
      inputSchema: {},
      outputSchema: {
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
      },
    },
    async () => {
      const result = await getDashboard(client);
      return toolResponse(result);
    },
  );

  server.registerTool(
    "nseap_health",
    {
      title: "平台连接检查",
      description: "检查 nseap-mcp 到平台的连接状态（含延迟与运行模式）。",
      inputSchema: {},
      outputSchema: {
        ok: z.boolean(),
        server: z.string().optional(),
        mode: z.string().optional(),
        latencyMs: z.number().optional(),
        error: z.object({ code: z.string(), message: z.string() }).optional(),
      },
    },
    async () => {
      const result = await checkHealth(client);
      return toolResponse(result);
    },
  );

  server.registerTool(
    "nseap_submit_review",
    {
      title: "提交评审",
      description:
        "提交评审：peer（同伴评审，平台校验只能评被分配的提交，不能评自己）或 teacher（教师终审，Agent 通道走消息总线 manual_review_adjustment）。分数必须 0-100。",
      inputSchema: {
        evaluatorType: z.enum(["peer", "teacher"]).describe("评审类型：peer 同伴 / teacher 教师终审"),
        submissionId: z.string().describe("提交 ID"),
        score: z.number().min(0).max(100).describe("分数（0-100）"),
        feedback: z.string().min(10).describe("评语（≥10 字，建议具体到代码）"),
        action: z.enum(["accept", "return"]).optional().describe("教师终审动作（仅 teacher 需要）"),
        submissionRecordId: z.string().optional().describe("飞书记录 ID（仅 teacher 需要）"),
      },
      outputSchema: {
        ok: z.boolean(),
        evaluationId: z.string().optional(),
        message: z.string().optional(),
        error: z.object({ code: z.string(), message: z.string() }).optional(),
      },
    },
    async (args) => {
      const result = await submitReview(client, {
        evaluatorType: args.evaluatorType,
        submissionId: args.submissionId,
        score: args.score,
        feedback: args.feedback,
        ...(args.action !== undefined ? { action: args.action } : {}),
        ...(args.submissionRecordId !== undefined ? { submissionRecordId: args.submissionRecordId } : {}),
      });
      return toolResponse(result);
    },
  );

  server.registerTool(
    "nseap_notify",
    {
      title: "触发飞书通知",
      description:
        "经平台消息总线触发飞书通知：student_dm（通知自己，目标身份由平台从 from_agent 绑定，不接受伪造）或 class_group（班级群公告，需教师权限）。",
      inputSchema: {
        target: z.enum(["student_dm", "class_group"]).describe("通知对象"),
        text: z.string().min(1).max(2000).describe("通知文本"),
      },
      outputSchema: {
        ok: z.boolean(),
        task_id: z.string().optional(),
        error: z.object({ code: z.string(), message: z.string() }).optional(),
      },
    },
    async (args) => {
      const result = await sendNotification(client, {
        target: args.target,
        text: args.text,
      });
      return toolResponse(result);
    },
  );

  // ---- 教师专属工具（仅 NSEAP_ROLE=teacher 暴露） ----

  if (config.role === "teacher") {
    server.registerTool(
      "nseap_publish_challenge",
      {
        title: "发布挑战（教师）",
        description:
          "发布新挑战到 NSEAP 平台（经消息总线 challenge_publish）。平台会飞书群公告。需教师身份（NSEAP_ROLE=teacher + 教师 api_key）。",
        inputSchema: {
          title: z.string().min(1).max(100).describe("挑战标题"),
          brief: z.string().max(500).optional(),
          objective: z.string().max(2000).optional(),
          deliverables: z.string().min(1).describe("交付物说明（文本）"),
          rubric: z.string().min(1).describe("评分标准（文本）"),
          requiredDeliverables: z.string().optional().describe("必要交付物 pattern（逗号分隔，支持 * 通配符）"),
          rubricDimensions: z.string().optional().describe("结构化评分维度 JSON（rubric_dimensions）"),
          deadline: z.string().describe("截止时间（ISO 格式）"),
        },
        outputSchema: {
          ok: z.boolean(),
          challengeId: z.string().optional(),
          error: z.object({ code: z.string(), message: z.string() }).optional(),
        },
      },
      async (args) => {
        const result = await publishChallenge(client, {
          title: args.title,
          ...(args.brief !== undefined ? { brief: args.brief } : {}),
          ...(args.objective !== undefined ? { objective: args.objective } : {}),
          deliverables: args.deliverables,
          rubric: args.rubric,
          ...(args.requiredDeliverables !== undefined ? { requiredDeliverables: args.requiredDeliverables } : {}),
          ...(args.rubricDimensions !== undefined ? { rubricDimensions: args.rubricDimensions } : {}),
          deadline: args.deadline,
        });
        return toolResponse(result);
      },
    );
  }

  // ---- 提交工具（核心闭环） ----

  server.registerTool(
    "nseap_submit_project",
    {
      title: "提交项目到 NSEAP",
      description:
        "提交项目：可选本地预检（workdir+required_deliverables 时先检查，缺交付物直接拦截）→ 构造 Envelope → 提交平台消息总线 → 返回 task_id（用 nseap_get_task 轮询）。禁止代他人提交（身份由平台绑定 api_key）。",
      inputSchema: {
        challengeId: z.string().describe("挑战 ID"),
        githubRepoUrl: z.string().url().describe("GitHub 仓库地址"),
        projectTitle: z.string().min(1).max(200),
        projectSummary: z.string().max(2000).optional(),
        aarText: z.string().min(10).describe("AAR 复盘（≥10 字）"),
        selfEvaluationText: z.string().min(10).describe("自评（≥10 字）"),
        isPublic: z.boolean().default(true),
        reviewMode: reviewModeSchema,
        workdir: z.string().optional().describe("本地项目目录（提供则先跑交付物预检）"),
        requiredDeliverables: z
          .string()
          .optional()
          .describe("挑战的交付物 pattern（与 workdir 配合使用；不提供则不预检）"),
        blockOnMissing: z.boolean().optional().default(true).describe("缺交付物时是否拦截提交（默认拦截）"),
      },
      outputSchema: {
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
      },
    },
    async (args) => {
      const result = await submitProject(
        client,
        {
          challengeId: args.challengeId,
          githubRepoUrl: args.githubRepoUrl,
          projectTitle: args.projectTitle,
          ...(args.projectSummary !== undefined ? { projectSummary: args.projectSummary } : {}),
          aarText: args.aarText,
          selfEvaluationText: args.selfEvaluationText,
          isPublic: args.isPublic,
          ...(args.reviewMode !== undefined ? { reviewMode: args.reviewMode } : {}),
          ...(args.workdir !== undefined ? { workdir: args.workdir } : {}),
          blockOnMissing: args.blockOnMissing,
          studentId: config.studentId, // 从配置注入，工具参数不可伪造
        },
        args.requiredDeliverables ?? null,
      );
      return toolResponse(result);
    },
  );

  return { server, config, client };
}

async function main(): Promise<void> {
  try {
    const { server, config, client } = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    client.logInfo(
      `nseap-platform MCP server ready (server=${config.serverUrl}, role=${config.role}, student=${config.studentId || "-"})`,
    );
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[nseap-mcp] 配置错误: ${err.message}`);
      console.error("[nseap-mcp] 本地开发可设 NSEAP_MOCK=1 跳过凭证校验。");
    } else {
      console.error("[nseap-mcp] 启动失败:", err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[nseap-mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
