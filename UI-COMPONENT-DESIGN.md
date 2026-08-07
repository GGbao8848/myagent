# 智能体输出组件能力与 UI 拓展 —— 设计讨论记录

> 状态：**讨论中，未实施**（2026-08-07 记录）
> 本文档记录「让智能体输出可交互表单/组件」的方向、现状、方案与待定决策，供后续实现时参考。

## 一、背景与动机

核心价值判断：**智能体不再只输出一堆文字，而是能输出可交互的表单/组件**——用户直接在对话里填表，提交后走业务流程（报工/报销/请假等）。这被认为是项目往后做最可能沉淀为「组件库」的部分。

触发场景：**报销 skill** 未来可能出现以下使用情况——智能体直接输出一个表单，包含下拉框选项、文件上传结构体等。

## 二、现状：表单能力已具备大部分

### 现有表单链路（报工已跑通）

```
agent 调用 run_script(script=report.py, args=[..., "--form-data"])
  → 脚本 stdout 输出：【表单数据】{JSON}【表单数据结束】
  → 后端 extractFormFromScript（chat.routes.ts）解析标记 → 组装 FormDto
  → SSE form 事件 → 前端 FormCard 渲染表格表单
```

另有兜底通道：agent 在回复文本直接输出 `【表单】{JSON}【表单结束】`，后端解析成 form 事件。

### 已支持的组件能力（FormDto 协议，packages/shared）

- `FormColumn.type`: `text` | `number` | `select`（下拉框，含 `options`）
- **列联动** `dependsOn` + `optionsBy`：父列值决定子列选项（如 工作类别→项目→任务，key 用 `"|"` 拼接）
- 表格模式 `columns` + `rows`（多行、可增删、可拆分）+ 垂直字段模式 `fields`
- 前端 `FormCard` 已支持表格/垂直两种渲染，报工是第一个使用者

### 表单提交机制

前端把表单 payload 拼成文本 `【表单提交：{id}】{json}`，走 send 回 agent，agent 侧脚本解析处理。**表单提交本质是「结构化的对话消息」**。

## 三、核心卡点：复用与动态声明

### 卡点 1：extractFormFromScript 写死报工

[chat.routes.ts 的 extractFormFromScript](apps/server/src/modules/chat/chat.routes.ts) 把「解析标记」和「报工字段」耦合死了：
- columns 写死报工 7 个字段（日期/工作类别/项目/任务/内容/标准/加班工时）
- optionsBy 拼 `"项目工时|{pid}"`、默认值写死 `"部门工作"`、id `"report"`、标题「报工单」

其他 skill 想输出表单，得复制整个函数再改。**方案**：通用化——脚本 JSON 自带 `columns` 则透传，无则兜底报工默认列。这样报工兼容，其他 skill 声明自己的 columns 即可复用整条渲染链路。

### 卡点 2：类 ERP 动态表单 = agent 现场决定字段

报工表单字段固定、agent 只填值；**「类 ERP 表单」字段由 agent 按业务逻辑现场决定**（如「报销打车费」→ 日期/金额/发票号/费用类型下拉/备注）。现有两条表单通道（脚本输出、文本标记）都不适合动态生成：
- 脚本输出是静态的
- 文本标记靠 agent 手写 JSON，易错、无校验

**推荐方案：新增 `request_form` 专用工具**——agent 传 `{columns, rows?, title?, description?}`，后端工具校验规整成合法 FormDto 后发 form 事件；格式错了返回错误提示让 agent 重试（闭环自愈）。保留两条旧通道不破坏。

## 四、文件上传：待定决策

现有协议无 file 类型。报销需要文件上传，两条回传路（**本次未定，等报销 skill 实际开发时再决策**）：

| 方案 | 实现 | 缺点 |
|---|---|---|
| base64 嵌入对话 | 前端读文件转 base64 塞进【表单提交】JSON | 大文件（>几 MB）撑爆对话消息长度 |
| 独立上传接口 | 前端先 POST /api/upload 拿文件 ID，payload 只带 ID，agent 按 ID 取 | 需后端加接口 + 临时存储 + 清理 |

需前端 FormTable 加 `<input type="file">` 渲染 + FormColumn.type 加 `"file"`。

## 五、开源 UI 组件库评估

需求：**元素种类全（按钮/输入框/文件上传/选择器…）、风格统一、有官网示例，加元素不自建**。技术栈 React 19 + Vite + Tailwind。

| 库 | 定位 | 评价 |
|---|---|---|
| **shadcn/ui**（ui.shadcn.com） | 可复制源码到项目的 Tailwind 组件 | 首推：风格由自己 Tailwind 控制、与现有外观统一；元素齐全有官网示例；加元素=复制组件文件 |
| **Ant Design**（ant.design） | 企业级完整库 | 元素最全（含 Upload 文件上传、Form 引擎、联动、校验）；国内常用；缺点自带样式非 Tailwind、体积大 |
| **MUI** | Material Design | 生态大文档好，风格与现有差异大 |
| **Headless UI** | Tailwind 官方无样式组件 | 与 shadcn 二选一 |
| **react-jsonschema-form / jsonforms.io** | JSON Schema → 表单 | 针对「agent 输出 → 渲染」层的生成器，可选配 shadcn/antd 主题 |

**倾向**：短期（报销 skill）用 Ant Design Form + Upload 最省事；长期（组件库愿景）用 shadcn/ui 与 Tailwind 风格统一。

## 六、待定决策（后续再讨论）

1. **复用边界**：轻量通用化解析器 vs 抽独立组件包（packages/form-lib）
2. **表单来源**：request_form 专用工具（推荐）vs 标记+SKILL.md 模板 vs 沿用脚本
3. **文件上传回传**：base64 vs 独立上传接口（等报销 skill 开发时定）
4. **开源库选型**：Ant Design（短期）vs shadcn/ui（长期）
5. **是否把 FormDto 协议升级为完整 JSON Schema**（对接 jsonforms/react-jsonschema-form 等生成器）

## 七、相关文件

- 表单协议：[packages/shared/src/index.ts](packages/shared/src/index.ts)（FormDto/FormColumn/FormField/SSEChatEvent）
- 表单解析：[apps/server/src/modules/chat/chat.routes.ts](apps/server/src/modules/chat/chat.routes.ts)（extractFormFromScript + 两条 form 事件通道）
- 前端渲染：[apps/web/src/views/DialogueView.tsx](apps/web/src/views/DialogueView.tsx)（FormCard/FormTable/FormCard 提交）
- 工具注册：[apps/server/src/agent/tools.ts](apps/server/src/agent/tools.ts)（run_script/run_pip，未来加 request_form）
- 报工 skill：[apps/server/data/skills/jiangsu-beiren-bip-work-hour-reporting](apps/server/data/skills/jiangsu-beiren-bip-work-hour-reporting)
