# nseap-mcp 接入 CogSeed 走查文档（M0）

> 基于 bonc-ai/cogseed 源码确认（`src/main/features/connectors/`）

## 一、接入原理

CogSeed 连接器系统支持**自定义 MCP server**（custom transport）：
- 用户经渲染层表单输入 stdio 命令 → `validateCustomTransport` 校验
  → `addCustomInstance`（manager.ts:1028）→ registry.upsert → 立即探测（probe）
- **渲染层表单即同意面**：用户看到并确认将执行的精确命令，无需二次弹窗
  （Commander 驱动的 `add_custom_connector` 工具才需 `install_confirm` 人工确认弹窗）
- env 中的密钥进 `secrets_enc` 加密存储，不落明文

## 二、注册步骤（用户操作）

1. CogSeed → 设置 → 连接器（Connectors）→ 添加自定义（Custom）
2. 填写表单：
   | 字段 | 值 |
   |---|---|
   | display_name | `NSEAP 学习平台` |
   | transport | `stdio` |
   | command | `node` |
   | args | `["/path/to/nseap-mcp/dist/index.js"]`（构建后）或 `npx` + `["tsx", "/path/to/nseap-mcp/src/index.ts"]`（开发） |
   | env | `NSEAP_SERVER_URL`=平台地址<br>`NSEAP_API_KEY`=学生 api_key<br>`NSEAP_STUDENT_ID`=学号<br>`NSEAP_COHORT`=班级（可选） |
   | cwd | nseap-mcp 目录（可选） |

3. 保存 → CogSeed 立即探测：probe 成功显示工具列表；失败显示 error 状态（可 remove+re-add）

## 三、模型如何调用

CogSeed 通过三个 umbrella meta-tools 暴露连接器（不把远端工具直接注入模型上下文）：

| meta-tool | 作用 |
|---|---|
| `list_connectors` | 列出可用连接器 |
| `list_connector_tools` | 列出某连接器的工具（经 tools_cache） |
| `call_connector_tool` | 调用具体工具（`tools-adapter.ts` 路由到 manager 的实时连接） |

**给学生/教师的使用指引**：对话中说"用 NSEAP 学习平台检查我项目缺什么"，模型会
经 meta-tools 调用 `nseap_check_deliverables` / `nseap_submit_project` 等。

## 四、验证清单

- [ ] probe 成功：连接器状态 healthy，6 个工具出现在 list_connector_tools
- [ ] `call_connector_tool(nseap_check_deliverables, {workdir, requiredDeliverables})` 返回缺失清单
- [ ] `call_connector_tool(nseap_list_challenges, {})` 返回挑战列表
- [ ] 提交（真实模式）：task_id 返回，飞书收到通知（需真实 api_key + 平台可达）
- [ ] 密钥安全：settings 里 env 不显示明文（secrets_enc）

## 五、已知边界

- probe 探测依赖平台可达；平台不可达时连接器显示 error（工具列表来自 tools_cache 兜底）
- CogSeed 的 tool 调用有超时；nseap 工具全部设计为快速返回（提交只入队返回 task_id，评分用 get_task 轮询）
- 当前 6 个工具是 M0 面；教师端工具（publish_challenge 等）在 M2 按角色配置扩展
