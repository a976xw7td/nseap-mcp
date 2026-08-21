# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

## [0.1.0] - 2026-08-21

### Added（M0 + M2 工具面 13/13）

**本地工具（离线可用，非权威）**
- `nseap_check_deliverables`：交付物通配符检查（支持 `*`/`?`，逗号/中文逗号/顿号/换行分隔）
- `nseap_prepare_submission`：提交预检报告（行动项 + 提交草稿）

**平台读工具（权威，可审计）**
- `nseap_list_challenges` / `nseap_get_challenge`
- `nseap_list_my_submissions` / `nseap_get_task` / `nseap_get_evaluation` / `nseap_get_dashboard`

**平台写工具**
- `nseap_submit_project`：提交（本地预检 → Envelope → 平台消息总线 → task_id）
- `nseap_submit_review`：评审（peer 平台校验分配 / teacher 走 manual_review_adjustment）
- `nseap_publish_challenge`：发布挑战（教师角色专属，走 challenge_publish）
- `nseap_notify`：触发飞书通知（学生 DM / 班级群）

**其他**
- `nseap_health`：平台连接检查

**工程与安全**
- strict TypeScript + zod 全量校验（inputSchema/outputSchema 均为 object）
- NseapError 错误码归一（8 种），退避重试（429/500/502/504 + 飞书限流码）
- mock 模式（NSEAP_MOCK=1）本地开发
- 架构红线：studentId 从配置注入（工具参数不可伪造）；平台 enforcedStudentId 二次校验
- 日志脱敏（api_key 永不打印明文）
- 28 个单元测试 + smoke 脚本 + GitHub Actions CI
- 角色裁剪：student 12 工具 / teacher 13 工具

### Fixed
- 交付物分隔符支持顿号（`、`），对齐课程文档实际用法
- 客户端端点对齐平台实际路径 `/api/nseap`（文档中的 `/api/hermes` 为历史名）

### Security
- 平台侧（ai-x-challenge-learning-mvp）配套加固：
  - Agent 通道提交 enforcedStudentId 身份绑定（修复代他人提交漏洞）
  - notify 消息类型 + handleNotify（通知目标从 from_agent 绑定）
