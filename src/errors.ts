/**
 * 统一错误类型与错误码（对齐 docs/design/10-MCP工具Schema.md §四）
 *
 * 错误码表：
 * - AUTH_FAILED        401 api_key 无效/过期
 * - FORBIDDEN          403 无权操作（代交/越权）
 * - CONFLICT           409 重复提交（60s 去重窗口）
 * - BUS_UNAVAILABLE    503 消息总线不可用
 * - NOT_FOUND          404 任务不存在/已过期
 * - NETWORK_ERROR      网络不可达/超时
 * - BAD_REQUEST        400 参数校验失败（平台侧拒绝）
 * - INTERNAL           未知错误
 */

export type NseapErrorCode =
  | "AUTH_FAILED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "BUS_UNAVAILABLE"
  | "NOT_FOUND"
  | "NETWORK_ERROR"
  | "BAD_REQUEST"
  | "INTERNAL";

const USER_FACING: Record<NseapErrorCode, string> = {
  AUTH_FAILED: "api_key 无效或已过期，请重新登录获取 NSEAP-config",
  FORBIDDEN: "无权执行此操作",
  CONFLICT: "重复提交（60 秒防重窗口内），请稍后重试",
  BUS_UNAVAILABLE: "消息总线不可用，请稍后重试",
  NOT_FOUND: "任务不存在或已过期",
  NETWORK_ERROR: "无法连接平台，请检查网络",
  BAD_REQUEST: "提交内容校验未通过",
  INTERNAL: "未知错误",
};

export class NseapError extends Error {
  readonly code: NseapErrorCode;
  readonly status?: number;
  /** 用户可读的中文提示（可直接展示） */
  readonly userMessage: string;

  constructor(code: NseapErrorCode, opts?: { message?: string; status?: number; cause?: unknown }) {
    super(opts?.message ?? USER_FACING[code]);
    this.name = "NseapError";
    this.code = code;
    if (opts?.status !== undefined) this.status = opts.status;
    this.userMessage = USER_FACING[code];
    if (opts?.cause !== undefined) this.cause = opts.cause;
  }
}

/** 把平台 HTTP 状态码映射为错误码 */
export function httpStatusToCode(status: number): NseapErrorCode {
  switch (status) {
    case 401:
      return "AUTH_FAILED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 400:
    case 422:
      return "BAD_REQUEST";
    case 503:
      return "BUS_UNAVAILABLE";
    default:
      return "INTERNAL";
  }
}

/** 工具统一返回包装：MCP 工具不抛错（抛错会中断模型工具循环），改为返回结构化结果 */
export interface ToolResult<T = unknown> {
  ok: boolean;
  error?: { code: NseapErrorCode; message: string };
  data?: T;
}

export function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(err: unknown): ToolResult<T> {
  if (err instanceof NseapError) {
    return { ok: false, error: { code: err.code, message: err.userMessage } };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { ok: false, error: { code: "INTERNAL", message: msg } };
}
