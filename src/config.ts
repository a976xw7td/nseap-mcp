/**
 * nseap-mcp 配置加载（T1）
 *
 * 配置来源：环境变量（由 Cogseed MCP Hub 拉起进程时注入）
 * - NSEAP_SERVER_URL  平台地址（默认 http://49.233.169.16）
 * - NSEAP_API_KEY     学生/教师 api_key（从 Tauri keychain 注入，绝不落盘）
 * - NSEAP_STUDENT_ID  当前学生学号（from_agent 固定身份，禁止工具参数伪造）
 * - NSEAP_COHORT      班级/队列（同伴评审分配用）
 * - NSEAP_MOCK        1=启用 mock 模式（本地开发/无凭证时可用）
 * - NSEAP_ROLE        当前角色：student | teacher（决定工具面裁剪）
 */

export type Role = "student" | "teacher";

export interface NseapConfig {
  serverUrl: string;
  apiKey: string;
  studentId: string;
  cohort: string;
  mock: boolean;
  role: Role;
}

const REQUIRED_VARS = ["NSEAP_SERVER_URL", "NSEAP_API_KEY", "NSEAP_STUDENT_ID"] as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * 读取并校验配置。缺失必需变量时抛出 ConfigError（启动即失败，不静默降级）。
 * 日志安全：api_key 只允许脱敏打印。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): NseapConfig {
  const mock = env.NSEAP_MOCK === "1" || env.NSEAP_MOCK === "true";

  // mock 模式下 serverUrl/api_key 可豁免（serverUrl 有默认值）
  const missing = REQUIRED_VARS.filter((k) => {
    if (mock && (k === "NSEAP_API_KEY" || k === "NSEAP_SERVER_URL")) return false;
    return !env[k]?.trim();
  });

  if (missing.length > 0) {
    throw new ConfigError(
      `缺少必需环境变量: ${missing.join(", ")}。` +
        `配置方法：Cogseed MCP Hub 的 env 注入，或本地开发设 NSEAP_MOCK=1。`,
    );
  }

  return {
    serverUrl: (env.NSEAP_SERVER_URL ?? "http://49.233.169.16").replace(/\/+$/, ""),
    apiKey: (env.NSEAP_API_KEY ?? "").trim(),
    studentId: (env.NSEAP_STUDENT_ID ?? "").trim(),
    cohort: (env.NSEAP_COHORT ?? "").trim(),
    mock,
    role: (env.NSEAP_ROLE === "teacher" ? "teacher" : "student") as Role,
  };
}

/** 脱敏显示 api_key（日志用） */
export function maskKey(key: string): string {
  if (!key) return "<empty>";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

/** 当前学生对应的平台 Agent 身份（架构红线：from_agent 固定，不接受参数伪造） */
export function fromAgentOf(config: NseapConfig): string {
  return `student-companion-${config.studentId}`;
}
