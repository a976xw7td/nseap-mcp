/**
 * 平台 HTTP Agent 协议客户端（T2）
 *
 * 协议：AGENT_PROTOCOL.md v1.0（x-api-key + POST {server}/api/nseap）
 * 注意：平台实际端点是 /api/nseap（app/api/nseap/route.ts）；文档中的 /api/hermes 为历史名
 * 约束继承：
 * - Agent 通道提交必须经消息总线（503 不降级）
 * - 所有消息含 from_agent/to_agent/audit_trace_pointer
 * - 日志脱敏：绝不打印 api_key
 */

import type { NseapConfig } from "./config.js";
import { fromAgentOf, maskKey } from "./config.js";
import { NseapError, httpStatusToCode } from "./errors.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 504]);
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [500, 1000, 2000];

// 飞书限流错误码（OpenClaw 实测）：经平台透传时以状态码/消息出现
const RATE_LIMIT_MARKERS = ["230020", "230006", "rate limit", "too many requests"];

export interface EnvelopeResponse {
  ok: boolean;
  task_id?: string;
  error?: string;
}

export class PlatformClient {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly fromAgent: string;
  private readonly mock: boolean;
  readonly maskedKey: string;

  constructor(config: NseapConfig) {
    this.base = config.serverUrl;
    this.apiKey = config.apiKey;
    this.fromAgent = fromAgentOf(config);
    this.mock = config.mock;
    this.maskedKey = maskKey(config.apiKey);
  }

  /** GET JSON（平台 REST API） */
  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  /** POST JSON（平台 REST API） */
  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body });
  }

  /** POST Envelope 到 Agent 通道（/api/nseap），返回 task_id */
  async postEnvelope(messageType: string, toAgent: string, payload: Record<string, unknown>): Promise<EnvelopeResponse> {
    const auditId = `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const body = {
      message_type: messageType,
      to_agent: toAgent,
      payload: { ...payload, audit_trace_pointer: auditId },
    };
    const resp = await this.post<EnvelopeResponse>("/api/nseap", body);
    if (!resp.ok) {
      throw new NseapError("INTERNAL", { message: resp.error ?? "平台拒绝请求" });
    }
    return resp;
  }

  private async request<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
    if (this.mock) {
      return mockResponse<T>(path);
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "x-api-key": this.apiKey,
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await fetch(`${this.base}${path}`, {
          method: init.method,
          headers,
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        });

        if (resp.ok) {
          return (await resp.json()) as T;
        }

        const code = httpStatusToCode(resp.status);
        // 可重试状态 + 未达上限 → 退避重试
        if (RETRYABLE_STATUS.has(resp.status) && attempt < MAX_RETRIES) {
          await sleep(RETRY_BACKOFF_MS[attempt] ?? 1000);
          continue;
        }
        // 飞书限流错误码 → 也退避重试一次
        const text = await resp.text().catch(() => "");
        if (RATE_LIMIT_MARKERS.some((m) => text.toLowerCase().includes(m)) && attempt < MAX_RETRIES) {
          await sleep(RETRY_BACKOFF_MS[attempt] ?? 1000);
          continue;
        }
        throw new NseapError(code, { status: resp.status, message: text.slice(0, 200) });
      } catch (err) {
        if (err instanceof NseapError) throw err;
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_BACKOFF_MS[attempt] ?? 1000);
          continue;
        }
      }
    }
    throw new NseapError("NETWORK_ERROR", { cause: lastErr });
  }

  logInfo(msg: string): void {
    console.error(`[nseap-mcp] ${msg} (key=${this.maskedKey}, mock=${this.mock})`);
  }

  /** 日志用：平台地址 */
  serverUrlForLog(): string {
    return this.base;
  }

  /** 日志用：运行模式 */
  modeForLog(): string {
    return this.mock ? "mock" : "live";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** mock 模式：本地开发/测试用，返回假数据 */
function mockResponse<T>(path: string): Promise<T> {
  if (path.startsWith("/api/challenges")) {
    return Promise.resolve({
      ok: true,
      challenges: [
        {
          challenge_id: "ch-mock-c03",
          title: "C03 · 提示词工程（mock）",
          status: "published",
          deadline: "2026-12-31",
          required_deliverables: "README.md, src/**, reflection.md",
        },
      ],
    } as T);
  }
  if (path.startsWith("/api/tasks/")) {
    return Promise.resolve({
      ok: true,
      task: { task_id: "task-mock", status: "completed", result: { ok: true, submissionId: "sub-mock" } },
    } as T);
  }
  if (path.startsWith("/api/submissions")) {
    return Promise.resolve({ ok: true, submissions: [] } as T);
  }
  if (path === "/api/evaluations") {
    return Promise.resolve({
      ok: true,
      evaluationId: "eval-mock-1",
      message: "同伴评审已提交（mock）",
    } as T);
  }
  if (path === "/api/nseap") {
    return Promise.resolve({ ok: true, task_id: `task-mock-${Date.now()}` } as T);
  }
  return Promise.resolve({ ok: true } as T);
}
