---
name: NSEAP提交
description: 按 NSEAP 教育平台流程提交挑战：交付物本地检查 → 填写提交信息 → 提交平台消息总线 → 轮询任务状态。含 AAR 复盘与自评要求。
---

# NSEAP 提交｜挑战提交闭环

本 Skill 封装 AI+X 课程的挑战提交流程，全部经 `nseap-*` 连接器工具完成（见
`connectors` 中的 NSEAP 学习平台自定义连接器）。本地检查离线可用，提交结果由
平台权威判定。

`use_when`:
- 用户要求提交挑战/作业/项目（如"提交 C03"、"帮我交作业"）
- 需要检查本地交付物是否齐全
- 需要查询挑战要求、截止时间、评分标准

`do_not_use_when`:
- 教师发布挑战（用 `nseap_publish_challenge`，仅教师连接器暴露）
- 单纯代码开发（交付物检查只对挑战提交有意义）

## 提交流程（必须按序）

### 1. 确认挑战

`nseap_list_challenges` → 找到目标挑战（按编号/标题匹配）→ `nseap_get_challenge`
拿 `required_deliverables`、`deadline`、`rubric`。

截止已过 → 明确告知用户并停止（不代用户决定是否逾期提交）。

### 2. 本地交付物预检

`nseap_prepare_submission`（workdir=用户项目目录，requiredDeliverables=挑战要求）：
- 缺失交付物 → 列出缺失清单 + 行动项，提示用户补充后重检
- 全绿 → 继续

### 3. 收集提交信息

必填：项目名称、GitHub 仓库地址、AAR 复盘（≥10 字，含"学到了什么/卡在哪/怎么改进"）、自评（≥10 字）。
缺失任何一项 → 询问用户，不代填。

### 4. 提交

`nseap_submit_project`（含 workdir+requiredDeliverables 触发二次预检，缺件直接拦截）。
拿到 `task_id`。

### 5. 轮询结果

`nseap_get_task`（task_id）→ pending/processing 时告知用户"处理中"，completed/failed
时给出结果。成功后提醒：飞书会收到通知，AI 初评就绪后可用
`nseap_get_evaluation` 查评分详情。

## 停止规则

- 用户取消或明确要求停止
- 交付物缺失且用户选择不补充（blockOnMissing 拦截）
- 平台返回 401（api_key 无效）→ 告知用户重新获取 NSEAP-config
- 平台返回 503（总线不可用）→ 告知稍后重试，不重复提交

## 失败行为

never_invent_submission_content；never_skip_local_check；never_retry_after_409_without_user；
return_completed_and_uncompleted_parts
