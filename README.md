# nseap-mcp

NSEAP 教育平台 × Cogseed 连接器 —— stdio MCP Server。包装平台 HTTP Agent 协议（x-api-key），提供**本地交付物检查**与**提交-评审-通知闭环**工具。

## 定位

- **本地工具**（离线可用，非权威）：`nseap_check_deliverables` —— 按挑战交付物要求（支持 `*` 通配符）在本地工作区检查文件完整性
- **平台工具**（权威，可审计）：挑战查询 / 我的提交 / 任务轮询 / 提交项目
- **架构红线**（继承平台约束）：
  - 提交必须经平台消息总线（Agent 通道，不降级）
  - 不暴露任何直写飞书表的工具
  - `from_agent` 固定为 `student-companion-<学号>`，不接受工具参数伪造
  - 长耗时一律 submit → task_id → 轮询

## 工具列表（13 个，按角色裁剪）

**学生角色**（12 个）：

| 工具 | 说明 |
|---|---|
| `nseap_check_deliverables` | 本地交付物通配符检查（离线） |
| `nseap_prepare_submission` | 本地提交预检报告（行动项+提交草稿） |
| `nseap_list_challenges` | 已发布挑战列表 |
| `nseap_get_challenge` | 单挑战详情（交付物/rubric/评分维度/红线） |
| `nseap_list_my_submissions` | 我的提交记录 |
| `nseap_get_task` | 异步任务状态（提交后轮询） |
| `nseap_submit_project` | 提交项目（预检→Envelope→task_id） |
| `nseap_get_evaluation` | 评审详情（AI/教师/同伴，分项分数+优缺点） |
| `nseap_submit_review` | 提交评审（peer 平台校验分配 / teacher 走消息总线） |
| `nseap_get_dashboard` | 进度统计（挑战/提交/完成/待评审） |
| `nseap_notify` | 触发飞书通知（学生 DM/班级群） |
| `nseap_health` | 平台连接检查（延迟/模式） |

**教师角色**（+1）：`nseap_publish_challenge` — 发布挑战（走消息总线，飞书群公告）

## 安装与运行

```bash
pnpm install          # Node ≥20
pnpm dev              # 开发模式（tsx 直跑）
pnpm build && pnpm start   # 生产模式（dist/）
pnpm bundle           # 单文件打包（dist-bundle/nseap-mcp.mjs，自包含无 node_modules）
```

### 分发（M1，推荐）

```bash
pnpm bundle
# 产物 dist-bundle/nseap-mcp.mjs（1.1MB 自包含），任意有 Node ≥20 的机器：
node dist-bundle/nseap-mcp.mjs
```

CogSeed 连接器 command 直接指向该文件，无需 nseap-mcp 项目环境。

环境变量见 [.env.example](.env.example)。

### 本地开发（mock 模式，无需平台凭证）

```bash
NSEAP_MOCK=1 NSEAP_STUDENT_ID=test-student pnpm dev
```

### 接入 CogSeed

1. CogSeed 中打开连接器设置 → 添加自定义 MCP（custom transport, stdio）
2. 填入：
   - **display_name**: `NSEAP 学习平台`
   - **command**: `npx tsx /path/to/nseap-mcp/src/index.ts`（或构建后的 `node /path/to/nseap-mcp/dist/index.js`）
   - **env**（API key 走 secrets_enc 加密存储）:
     - `NSEAP_SERVER_URL` = 平台地址
     - `NSEAP_API_KEY` = 学生的 api_key（平台登录后下载 NSEAP-config-{学号}.json 获取）
     - `NSEAP_STUDENT_ID` = 学号
     - `NSEAP_COHORT` = 班级
3. 确认弹窗（展示将执行的精确命令）→ 用户同意后生效
4. 模型经 `list_connector_tools` / `call_connector_tool` 使用这些工具

## 测试

```bash
pnpm typecheck   # tsc 零错误
pnpm test        # 33 个单元测试（含 5 个契约测试）
pnpm smoke       # 冒烟（握手/12工具注册/预检/拦截）
pnpm demo:student  # 学生全流程预演（9 步，mock 模式，无需凭证）
pnpm demo:teacher  # 教师全流程预演（5 步，mock 模式，无需凭证）
```

## 错误码

| code | 含义 |
|---|---|
| `AUTH_FAILED` | api_key 无效/过期 |
| `FORBIDDEN` | 无权操作 |
| `CONFLICT` | 重复提交（60s 防重窗口） |
| `BUS_UNAVAILABLE` | 消息总线不可用 |
| `NOT_FOUND` | 任务不存在/已过期 |
| `NETWORK_ERROR` | 无法连接平台 |
| `BAD_REQUEST` | 校验未通过（如缺交付物） |
| `INTERNAL` | 未知错误 |

## 目录结构

```
src/
  index.ts        # MCP Server 主入口（6 工具注册）
  config.ts       # 环境变量加载 + 脱敏 + 身份固定
  errors.ts       # NseapError + 错误码表
  client.ts       # 平台 HTTP 客户端（重试/限流/mock）
  tools/
    local.ts      # 交付物检查（纯本地）
    read.ts       # 只读工具
    submit.ts     # 提交工具
test/             # 单元测试
scripts/smoke-m0.sh  # M0 冒烟
```

## 许可

MIT
