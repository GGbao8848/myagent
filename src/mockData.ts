import { Skill, MemoryItem, MCPServer, ModelConfig, UserProfile, Session, ScheduleTask } from './types';

export const initialUserProfile: UserProfile = {
  name: "张明",
  role: "数字化项目运营总监",
  department: "数字化解决方案事业部",
  tonePreference: "professional",
  formatPreference: "markdown"
};

export const initialSkills: Skill[] = [
  {
    id: "doc-analyzer",
    name: "文档智能解析与摘要",
    description: "深入剖析 PDF、Docx、Markdown 文档，精确提取核心事实、行动项（Action Items）以及潜在风险指标，并按照企业周报模板重排版。",
    category: "document",
    enabled: true,
    parameters: [
      { name: "max_summary_length", type: "number", description: "摘要最大字数限制", value: "800" },
      { name: "extract_action_items", type: "boolean", description: "是否强制提取行动项列表", value: "true" },
      { name: "industry_context", type: "string", description: "目标行业背景约束", value: "SaaS 软件开发" }
    ]
  },
  {
    id: "work-reporter",
    name: "日报周报极速整理助理",
    description: "全自动聚合过去几天内的碎片化工作记录，将白话草稿、会议口述转换成逻辑严密、分项清晰的标准中高层述职周报汇报。",
    category: "office",
    enabled: true,
    parameters: [
      { name: "report_depth", type: "string", description: "汇报深度 (summary/detailed)", value: "detailed" },
      { name: "include_metrics", type: "boolean", description: "是否强制提取数字和百分比指标", value: "true" }
    ]
  },
  {
    id: "financial-calc",
    name: "企业财务对账报表分析",
    description: "自动化比对收支流水账目。提供跨行多币种核算、项目预算超支预警，并支持自动转换为复式记账复核条目。",
    category: "utility",
    enabled: false,
    parameters: [
      { name: "currency_unit", type: "string", description: "基础核算货币类型 (CNY/USD)", value: "CNY" },
      { name: "alert_threshold", type: "number", description: "预算超支预警阈值比例 (%)", value: "90" }
    ]
  },
  {
    id: "mail-writer",
    name: "职场外交官邮件拟定",
    description: "基于极其简短的上下文输入，自动拟定得体、专业的商务往来邮件，支持配置邮件情绪基调，一键生成草稿并接入邮件客户端。",
    category: "office",
    enabled: true,
    parameters: [
      { name: "politeness_level", type: "string", description: "礼貌和谦逊程度 (standard/high/executive)", value: "high" },
      { name: "add_disclaimer", type: "boolean", description: "是否自动附加保密和合规免责声明", value: "false" }
    ]
  }
];

export const initialMemories: MemoryItem[] = [
  {
    id: "mem_1",
    content: "用户偏好在总结报告中，使用多级大纲、粗体关键字及对比表格来强调业务指标。",
    category: "preference",
    createdAt: "2026-07-10 14:22",
    confidence: 98
  },
  {
    id: "mem_2",
    content: "用户是某科技公司的数字化解决方案运营总监，其团队主要面向 B 端企业客户提供 SaaS 转型服务。",
    category: "profile",
    createdAt: "2026-07-11 09:15",
    confidence: 95
  },
  {
    id: "mem_3",
    content: "在进行核心技术讨论或研发统计时，偏好附带对应的 MCP 数据库校验结果来确保信息百分百真实。",
    category: "preference",
    createdAt: "2026-07-12 18:01",
    confidence: 92
  },
  {
    id: "mem_4",
    content: "通常在每周五下午16:00后，需要系统发出周报汇总结案的提醒并开启报表分析流程。",
    category: "schedule",
    createdAt: "2026-07-13 11:30",
    confidence: 89
  }
];

export const initialMcpServers: MCPServer[] = [
  {
    id: "mcp_fs",
    name: "Local Filesystem Explorer",
    type: "stdio",
    urlOrCommand: "npx -y @modelcontextprotocol/server-filesystem /workspace/corporate_records",
    status: "connected",
    tools: [
      { name: "read_file", description: "读取指定路径文件的纯文本或二进制解析内容" },
      { name: "write_file", description: "创建或安全覆盖指定绝对路径下的文本内容" },
      { name: "list_directory", description: "扫描指定路径的文件夹目录结构并返回文件清单" },
      { name: "search_text_grep", description: "基于正则表达式在目录下的所有文本中快速检索内容" }
    ]
  },
  {
    id: "mcp_db",
    name: "SaaS DB Analytical Portal",
    type: "sse",
    urlOrCommand: "https://mcp-gateway.corporate-internal.net/sse",
    status: "connected",
    tools: [
      { name: "query_database_records", description: "传入标准 SQL 语句读取云端生产报表与运营库数据" },
      { name: "fetch_schema_metadata", description: "拉取指定关系型数据库表或视图的字段结构信息" },
      { name: "generate_audit_log", description: "对特定用户操作日志记录进行行为合规性审查" }
    ]
  },
  {
    id: "mcp_mail",
    name: "Enterprise Exchange Sync",
    type: "sse",
    urlOrCommand: "https://mcp.office-mail.corporate.net/sse",
    status: "disconnected",
    tools: [
      { name: "search_unread_emails", description: "检索企业邮箱中今日未读的核心往来邮件" },
      { name: "insert_draft_auto_reply", description: "智能将建议草稿回复注入到特定会话邮件草稿箱" }
    ]
  }
];

export const initialModelConfigs: ModelConfig[] = [
  {
    id: "model_gemini",
    name: "Gemini 3.5 Flash",
    provider: "Gemini",
    apiKey: "• • • • • • • • • • • • • • • •",
    baseUrl: "系统内部集成接入",
    enabled: true
  },
  {
    id: "model_gpt4o",
    name: "GPT-4o (企业高速版)",
    provider: "OpenAI",
    apiKey: "sk-proj-............................",
    baseUrl: "https://api.openai.com/v1",
    enabled: true
  },
  {
    id: "model_deepseek",
    name: "DeepSeek V3 (极速推理)",
    provider: "DeepSeek",
    apiKey: "sk-ds-............................",
    baseUrl: "https://api.deepseek.com/v1",
    enabled: true
  },
  {
    id: "model_claude",
    name: "Claude 3.5 Sonnet",
    provider: "Claude",
    apiKey: "",
    baseUrl: "https://api.anthropic.com/v1",
    enabled: false
  }
];

export const initialSessions: Session[] = [
  {
    id: "session_1",
    title: "📊 运营周报全自动整理",
    model: "Gemini 3.5 Flash",
    createdAt: "2026-07-14 10:00",
    messages: [
      {
        id: "msg_1_1",
        role: "user",
        content: "张经理，帮我把本周的一些散碎记录整理成一份发给数字化运营总监的周报。主要内容有：这周我测试了3个技能组件，都通过了；对接了 MCP 那个本地文件系统和数据库分析，表现很稳定；另外画像偏好起效了，能自动记住总监的工作风格。请按照我的画像偏好排版输出。",
        timestamp: "10:00"
      },
      {
        id: "msg_1_2",
        role: "assistant",
        content: `### 📊 企业工作周报整理（自动生成）

**汇报人：** 张明  
**部门：** 数字化解决方案事业部  
**汇报周期：** 2026年7月第二周  

---

#### 1. 本周工作达成情况
- **[自动化办公]** 完成了新版智能助手界面的集成测试，对接了 **3个启用技能**，运行状态良好。
- **[数据链通]** 成功测试了 **MCP (Model Context Protocol)** 协议服务器接口，成功调取了外部文件系统和数据库查询工具，解决了异构系统工具调用不一致的问题。
- **[画像记忆]** 学习并更新了用户画像：已记录关于“*用户偏好在总结报告中，使用多级大纲、粗体关键字及对比表格来强调业务指标*”的定制化配置，自动应用输出。

#### 2. 下周工作计划
1. **[技能扩展]** 预计再上传1-2个自定义办公技能包，主要针对企业资产管理和报表审核。
2. **[系统对接]** 继续拓宽 MCP 服务器的工具集，对接更多企业 ERP 和 CRM 数据，实现一键录入。
3. **[性能优化]** 推进在“设置”页中启用多模型切换功能，提高极端复杂任务的推理准确率。

> 💡 *本报告已根据您的“专业规范”语气偏好及“Markdown”格式偏好自动排版生成。*`,
        timestamp: "10:01",
        thinking: "解析用户输入指令，识别核心办公需求...\n提取记忆画像，比对用户工作背景及输出偏好...\n匹配就绪技能组件和 MCP 服务器数据连接...\n调度内置自动化技能插件 [日报周报极速整理助理]...\n整合大语言模型语义理解与工具执行结果...\n按照企业规范输出排版，完成内容生成。",
        toolsUsed: [
          {
            name: "skill_executor.work-reporter",
            args: '{"report_depth":"detailed","include_metrics":"true"}',
            status: "success",
            result: "Executed skill '日报周报极速整理助理' perfectly."
          }
        ]
      }
    ]
  },
  {
    id: "session_2",
    title: "🔗 MCP 数据库接口联调测试",
    model: "DeepSeek V3 (极速推理)",
    createdAt: "2026-07-14 15:30",
    messages: [
      {
        id: "msg_2_1",
        role: "user",
        content: "检查一下当前 MCP 服务器连接了没有，并调用数据库工具查一下今天的接口状态数据。",
        timestamp: "15:30"
      },
      {
        id: "msg_2_2",
        role: "assistant",
        content: `你好！我刚刚通过 MCP (Model Context Protocol) 协议穿透了本地中继，成功向 \`SaaS DB Analytical Portal\` 服务器发送了数据状态查询。

以下是调用 \`query_database_records\` 工具返回的数据反馈：

| 数据表/端点 | 连接状态 | 延迟 (ms) | 数据行受影响 | 备注说明 |
| :--- | :--- | :--- | :--- | :--- |
| **api_gateway_logs** | Active | 12ms | 12 | 过去24小时接口全链路正常 |
| **saas_subscription** | Active | 45ms | 340 | 完成了与 Stripe 企业计费账户的对账 |
| **mcp_handshake** | Normal | 8ms | 1 | 本次会话客户端心跳连通正常 |

我已经自动将此结果计入到当前的工作日志，并在日志末尾附加了本条校验条目。还需要我调用其他的 MCP 文件系统工具为您读取本地配置文件吗？`,
        timestamp: "15:31",
        thinking: "解析用户关于 MCP 的指令...\n定位到已连通的 MCP 服务器: SaaS DB Analytical Portal...\n正在发送工具调用请求 query_database_records 并携带 SQL 语句...\n接口响应返回 12 行记录。\n正在将结果转换为 Markdown 样式并附带分析说明...",
        toolsUsed: [
          {
            name: "saas_db_analytical_portal.query_database_records",
            args: '{"query": "SELECT * FROM api_gateway_logs WHERE timestamp >= TODAY()"}',
            status: "success",
            result: '{"status": "success", "data_source": "SaaS DB Analytical Portal", "rows_affected": 3}'
          }
        ]
      }
    ]
  }
];

export const initialScheduleTasks: ScheduleTask[] = [
  {
    id: "task_1",
    title: "每日早间办公资讯与待办提醒",
    scheduleType: "daily",
    timeValue: "09:00",
    cronExpression: "0 9 * * 1-5",
    prompt: "梳理当前所有已连接的 MCP 服务器状态，自动拉取我的日程待办，并生成一份今日清晨待办重点纲要。",
    displayFormat: "bullet",
    enabled: true,
    createdAt: "2026-07-12 09:00",
    lastRunTime: "2026-07-14 09:00",
    nextRunTime: "2026-07-15 09:00",
    runCount: 2
  },
  {
    id: "task_2",
    title: "每周五全员工作周报自动汇总与润色",
    scheduleType: "weekly",
    timeValue: "周五 17:30",
    cronExpression: "30 17 * * 5",
    prompt: "汇总这周的会话记录、执行过的技能包结果，并使用优雅、大气的专业语气自动排版润色一份企业级工作周报，包含本周达成、下周计划和遇到的技术风险点。",
    displayFormat: "markdown",
    enabled: true,
    createdAt: "2026-07-11 12:00",
    lastRunTime: "2026-07-10 17:30",
    nextRunTime: "2026-07-17 17:30",
    runCount: 1
  },
  {
    id: "task_3",
    title: "每月末 SaaS 数据库运行状态及订阅审计",
    scheduleType: "monthly",
    timeValue: "28日 23:59",
    cronExpression: "59 23 28 * *",
    prompt: "通过 MCP 服务器的 query_database_records 工具，拉取本月 api_gateway_logs 及 saas_subscription 表。检索是否有异常延迟和异常订阅扣款，并生成对比分析数据表格。",
    displayFormat: "table",
    enabled: false,
    createdAt: "2026-07-13 15:40",
    runCount: 0
  }
];

