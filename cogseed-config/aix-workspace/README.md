# AI+X 工作空间 · CogSeed 配置包

> 把 NSEAP 教育平台接进 CogSeed（bonc-ai/cogseed）的预设配置：学习助手 Agent + 提交 Skill + 平台连接器。
> CogSeed 本体零改动 —— 全部经 UI 导入。

## 一、目录结构

```
aix-workspace/
├── agents/aix-nseap-companion.json      # NSEAP 学习助手 Agent（导入 AI 团队）
├── skills/nseap-submit/SKILL.md         # NSEAP 提交 Skill（导入技能库）
└── connectors/nseap-platform.json       # 平台连接器配置（自定义 MCP 模板）
```

## 二、安装步骤（CogSeed UI）

### 1. 连接器（先装，Agent 依赖它的工具）

设置 → 连接器 → 添加自定义（stdio），按 `connectors/nseap-platform.json` 填：

| 字段 | 值 |
|---|---|
| display_name | `NSEAP 学习平台` |
| transport | `stdio` |
| command | `node` |
| args | `["<nseap-mcp 路径>/dist/index.js"]` |
| env | `NSEAP_SERVER_URL`=平台地址<br>`NSEAP_API_KEY`=<学生 api_key>（secrets_enc 加密存储）<br>`NSEAP_STUDENT_ID`=<学号><br>`NSEAP_COHORT`=<班级> |

nseap-mcp 获取：`git clone https://github.com/a976xw7td/nseap-mcp && cd nseap-mcp && pnpm install && pnpm build`

### 2. 技能库

导入 `skills/nseap-submit`（SKILL.md）。

### 3. AI 团队

导入 `agents/aix-nseap-companion.json`，并把「NSEAP 学习平台」连接器加入该 Agent 可用连接器。

## 三、使用

对话中说：
- "看看 C03 要交什么" → 查挑战
- "帮我检查项目缺什么" → 本地交付物预检
- "提交 C03" → 完整提交流程（预检→提交→轮询）
- "我上次评分多少" → 查评审详情

## 四、教师端（可选）

教师建第二个连接器：`NSEAP_ROLE=teacher` + 教师 api_key → 额外获得
`nseap_publish_challenge`（发布挑战 + 飞书群公告）。
