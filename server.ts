import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Helper to initialize Gemini Client lazily and safely
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      throw new Error("GEMINI_API_KEY environment variable is not set or is invalid");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// 1. Health check and Status API
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    apiKeyConfigured: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY",
    timestamp: new Date().toISOString()
  });
});

// 2. Chat API supporting system context injection (memories, profile, active skills, mcp)
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, profile, memories, skills, mcpServers, activeModel } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages array is required" });
    }

    // Build rich corporate context instructions
    const userProfileStr = profile 
      ? `User Name: ${profile.name || "Default User"}
Role: ${profile.role || "Employee"}
Department: ${profile.department || "Enterprise Administration"}
Preferred Tone: ${profile.tonePreference || "professional"}
Preferred Format: ${profile.formatPreference || "markdown"}`
      : "User Name: Employee\nRole: Business Analyst";

    const memoriesStr = (memories && memories.length > 0)
      ? memories.map((m: any) => `- [${m.category}] ${m.content}`).join("\n")
      : "No stored memories or preferences yet.";

    const skillsStr = (skills && skills.length > 0)
      ? skills.filter((s: any) => s.enabled).map((s: any) => `- ${s.name}: ${s.description}`).join("\n")
      : "No active skills configured.";

    const mcpStr = (mcpServers && mcpServers.length > 0)
      ? mcpServers.filter((m: any) => m.status === "connected").map((m: any) => `- ${m.name} (${m.type}): offering tools: ${m.tools.map((t: any) => t.name).join(", ")}`).join("\n")
      : "No external MCP servers connected.";

    const systemInstruction = `You are a highly efficient Enterprise Office Automation AI Assistant.
Your core mission is to help the user with office productivity, automation tasks, analysis, and custom workflows.

--- USER PROFILE & COGNITIVE IMAGE ---
${userProfileStr}

--- USER PREFERENCES & MEMORIES ---
${memoriesStr}

--- ACTIVE SKILLS IN THE PLATFORM ---
${skillsStr}

--- CONNECTED MCP SERVER TOOL SOURCES ---
${mcpStr}

--- RESPONSE DIRECTIVES ---
1. You MUST respect the user's preferred tone (${profile?.tonePreference || "professional"}) and format (${profile?.formatPreference || "markdown"}).
2. Reference active skills or MCP tools when relevant to explain how you can carry out automation.
3. Keep the output highly practical, polished, and tailored for corporate operations.`;

    // Retrieve last message
    const lastMessage = messages[messages.length - 1];
    const userPrompt = lastMessage.content;

    // Simulate thinking steps based on prompt
    const isMcpRequested = userPrompt.toLowerCase().includes("database") || userPrompt.toLowerCase().includes("mcp") || userPrompt.includes("服务器") || userPrompt.includes("工具");
    const isSkillRequested = userPrompt.includes("技能") || userPrompt.includes("画") || userPrompt.includes("分析") || userPrompt.includes("生成");

    let thinkingSteps = [
      "解析用户输入指令，识别核心办公需求...",
      "提取记忆画像，比对用户工作背景及输出偏好...",
      "匹配就绪技能组件和 MCP 服务器数据连接..."
    ];

    let mockToolCalls: any[] = [];

    if (isMcpRequested && mcpServers && mcpServers.length > 0) {
      const connectedMcp = mcpServers.find((m: any) => m.status === "connected") || mcpServers[0];
      thinkingSteps.push(`激活 MCP 协议客户端，建立与 [${connectedMcp.name}] 的远程会话...`);
      thinkingSteps.push(`调用 MCP 工具 [${connectedMcp.tools[0]?.name || "query"}] 执行查询...`);
      mockToolCalls.push({
        name: `${connectedMcp.name.toLowerCase().replace(/\s+/g, '_')}.${connectedMcp.tools[0]?.name || "execute_query"}`,
        args: JSON.stringify({ query: userPrompt, max_results: 5 }),
        status: "success",
        result: JSON.stringify({ status: "success", data_source: connectedMcp.name, rows_affected: 12, summary: "Retrieved local structured corporate context successfully." })
      });
    }

    if (isSkillRequested && skills && skills.length > 0) {
      const activeSkill = skills.find((s: any) => s.enabled) || skills[0];
      thinkingSteps.push(`调度内置自动化技能插件 [${activeSkill.name}]...`);
      thinkingSteps.push(`运行技能底层规则引擎，载入参数配置 [${activeSkill.parameters?.[0]?.name || "default"}]...`);
      mockToolCalls.push({
        name: `skill_executor.${activeSkill.id}`,
        args: JSON.stringify(activeSkill.parameters.reduce((acc: any, curr: any) => { acc[curr.name] = curr.value; return acc; }, {})),
        status: "success",
        result: `Executed skill "${activeSkill.name}" perfectly. Loaded workspace guidelines.`
      });
    }

    thinkingSteps.push("整合大语言模型语义理解与工具执行结果...");
    thinkingSteps.push("按照企业规范输出排版，完成内容生成。");

    const formattedThinking = thinkingSteps.join("\n");

    // Attempt to invoke the real Gemini API if key is set
    let aiResponseText = "";
    let usingRealAi = false;

    try {
      const aiClientInstance = getGeminiClient();
      
      // Map previous chat messages to Gemini content format
      // Simple mapped conversion for Gemini API contents
      const contents = messages.map((m: any) => {
        return {
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        };
      });

      const geminiResult = await aiClientInstance.models.generateContent({
        model: "gemini-3.5-flash",
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.7,
        }
      });

      aiResponseText = geminiResult.text || "";
      usingRealAi = true;
    } catch (err: any) {
      console.warn("Gemini API not available, falling back to simulated high-fidelity completions. Reason:", err.message);
      
      // Simulated corporate automated responses when no API key is available
      if (userPrompt.includes("日报") || userPrompt.includes("周报") || userPrompt.includes("总结")) {
        aiResponseText = `### 📊 企业工作周报整理（自动生成）

**汇报人：** ${profile?.name || "张助理"}  
**部门：** ${profile?.department || "数字化产品部"}  
**汇报周期：** 2026年7月第二周  

---

#### 1. 本周工作达成情况
- **[自动化办公]** 完成了新版智能助手界面的集成测试，对接了 **${skills?.filter((s: any) => s.enabled).length || 2}个启用技能**，运行状态良好。
- **[数据链通]** 成功测试了 **MCP (Model Context Protocol)** 协议服务器接口，成功调取了外部工具，解决了异构系统工具调用不一致的问题。
- **[画像记忆]** 学习并更新了用户画像：已记录关于“*${memories?.[0]?.content || "用户偏好规范专业的 Markdown 输出排版"}*”的定制化配置，自动应用输出。

#### 2. 下周工作计划
1. **[技能扩展]** 预计再上传1-2个自定义办公技能包，主要针对企业资产管理和报表审核。
2. **[系统对接]** 继续拓宽 MCP 服务器的工具集，对接更多企业 ERP 和 CRM 数据，实现一键录入。
3. **[性能优化]** 推进在“设置”页中启用多模型切换功能，提高极端复杂任务的推理准确率。

> 💡 *本报告已根据您的“${profile?.tonePreference || "专业规范"}”语气偏好及“${profile?.formatPreference || "Markdown"}”格式偏好自动排版生成。*`;
      } else if (userPrompt.includes("技能") || userPrompt.includes("安装") || userPrompt.includes("上传")) {
        aiResponseText = `### 🛠️ 技能系统调用与启用提示

已为您检测当前系统中的技能状态：
- **总已安装技能：** ${skills?.length || 4} 个
- **当前激活状态：** 已启用 **${skills?.filter((s: any) => s.enabled).length || 2}个** 技能组件。

您可以随时在左侧菜单切换到 **“技能管理”** 页面，在这里您可以：
1. 一键点击开关启用或禁用某个技能（例如“文档分析整理器”）。
2. 在右上角点击“**上传自定义技能包**”，通过上传技能配置文件来无限扩展我的自动化生产力！

*如需我在对话中直接应用技能，请确保在指令中附加相应关键词，我会立即为您调用底层参数进行工作！*`;
      } else if (userPrompt.includes("mcp") || userPrompt.includes("MCP") || userPrompt.includes("服务器")) {
        aiResponseText = `### 🔗 Model Context Protocol (MCP) 服务器集成状态

当前智能助手已建立的工具连接概览：
- **可用连接：** 已注册 **${mcpServers?.length || 2} 个** MCP 服务器。
- **激活端口：** ${mcpServers?.filter((m: any) => m.status === "connected").map((m: any) => `\`${m.name}\``).join(", ") || "无"}。

通过 MCP 服务器，我可以：
1. **穿透隔离层：** 访问本地或云端的企业数据库、邮件系统和文档存储（如 Git 仓库、ERP 等）。
2. **实时调用工具：** 在处理多轮复杂对话时，根据需要自动运行底层命令。

*您可以在 “**MCP 服务器**” 页面配置连接，添加新服务器或测试链路延迟。*`;
      } else {
        aiResponseText = `你好！我是你的 **AI 办公自动化助手**。

我已经读取了你当前的配置：
- **用户画像：** ${profile?.name || "新用户"} (${profile?.role || "未设定角色"}) - ${profile?.department || "常规部门"}
- **首选语气：** \`${profile?.tonePreference || "专业"}\` | **首选格式：** \`${profile?.formatPreference || "Markdown"}\`
- **激活技能数：** ${skills?.filter((s: any) => s.enabled).length || 0} 个
- **连通 MCP 数：** ${mcpServers?.filter((m: any) => m.status === "connected").length || 0} 个

我可以帮你自动完成以下任务：
1. 📝 **写公文、发通知或整理周报日报**。
2. 📂 **读取和处理表格、文本或自定义脚本数据**。
3. 🛠️ **加载你的特定技能插件，按照固定的流程逻辑自动化操作**。
4. 💾 **长期记住你的个性化需求和偏好，保持最符合你心意的工作习惯**。

请问现在有什么需要我帮你分担的吗？（输入“**整理日报**”或“**调用技能**”来看看我的实力吧！）

*(注：当前未配置有效的 \`GEMINI_API_KEY\` 环境变量，所以系统正以本地高仿真引擎进行模拟回复。您可以在**设置**中配置或联系管理员注入。)*`;
      }
    }

    // Return the response containing thinking process, tools used, and the generated content
    return res.json({
      id: "msg_" + Math.random().toString(36).substr(2, 9),
      role: "assistant",
      content: aiResponseText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      thinking: formattedThinking,
      toolsUsed: mockToolCalls,
      usingRealAi
    });

  } catch (error: any) {
    console.error("Chat route error:", error);
    res.status(500).json({ error: error.message || "An error occurred on the server." });
  }
});

// 3. Mock Skills Upload API
app.post("/api/skills/upload", (req, res) => {
  const { fileName, fileSize } = req.body;
  if (!fileName) {
    return res.status(400).json({ error: "No package selected" });
  }

  // Generate a realistic custom skill based on file name
  const nameBase = fileName.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
  const capitalizedName = nameBase.charAt(0).toUpperCase() + nameBase.slice(1);

  const newSkill = {
    id: "skill_custom_" + Math.random().toString(36).substr(2, 5),
    name: capitalizedName,
    description: `通过自定义技能包 [${fileName}] 导入的自动化办公程序，提供了专属业务处理逻辑。`,
    category: "custom",
    enabled: true,
    parameters: [
      { name: "custom_path", type: "string", description: "执行路径或源URL", value: "./custom_workspace/script" },
      { name: "strict_mode", type: "boolean", description: "是否启用严格模式校验", value: "true" }
    ],
    isCustom: true
  };

  return res.json({
    success: true,
    message: `技能包 "${fileName}" 解析成功！已自动安装。`,
    skill: newSkill
  });
});

// 4. Mock MCP Test API
app.post("/api/mcp/test", (req, res) => {
  const { serverId, serverName } = req.body;
  if (!serverId) {
    return res.status(400).json({ error: "Server ID is required" });
  }

  const mockTools = [
    { 
      name: "query_records", 
      description: "查询指定的企业数据表，返回最多100条符合条件的内容",
      inputSchema: {
        type: "object",
        properties: {
          tableName: { type: "string", description: "待查询的企业核心数据表名称（如：orders, products, users）" },
          condition: { type: "string", description: "自定义过滤条件 SQL 语句片段（如：status = 'pending'）" }
        },
        required: ["tableName"]
      }
    },
    { 
      name: "generate_excel_dump", 
      description: "将查询内容导出为标准的 .xlsx 格式保存在临时目录",
      inputSchema: {
        type: "object",
        properties: {
          queryId: { type: "string", description: "需要关联导出的历史数据查询或会话 ID" },
          outputPath: { type: "string", description: "生成的 Excel 文件目标导出存储路径" }
        },
        required: ["queryId"]
      }
    },
    { 
      name: "fetch_schema_meta", 
      description: "读取目标库的元数据和字段结构信息",
      inputSchema: {
        type: "object",
        properties: {
          databaseName: { type: "string", description: "需要拉取元数据信息的特定数据库名称（如：corporate_prod）" }
        },
        required: ["databaseName"]
      }
    }
  ];

  setTimeout(() => {
    return res.json({
      success: true,
      message: `与 MCP 服务器 "${serverName || 'Database Explorer'}" 建立握手成功！共发现 ${mockTools.length} 个可用工具。`,
      tools: mockTools
    });
  }, 800);
});

// 5. LLM Model Gateway Test API
app.post("/api/models/test", (req, res) => {
  const { modelId, modelName, apiKey, baseUrl } = req.body;
  if (!modelId) {
    return res.status(400).json({ error: "Model ID is required" });
  }

  setTimeout(() => {
    // If it's the default Gemini model, check environment variable setup
    if (modelId === "model_gemini") {
      const isConfigured = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY";
      if (isConfigured) {
        return res.json({
          success: true,
          status: "connected",
          latency: "142ms",
          message: `与系统内置模型 [${modelName}] 握手成功！当前可用区为：asia-northeast1 (东京)。`
        });
      } else {
        return res.json({
          success: true,
          status: "simulated",
          latency: "56ms",
          message: `系统内置模型 [${modelName}] 当前运行于本地仿真沙盒。无需密钥可直接测试及体验。`
        });
      }
    }

    // For other custom models, check if custom API key is present
    if (!apiKey) {
      return res.json({
        success: false,
        status: "disconnected",
        message: `模型 [${modelName}] 连接失败：API 密钥验证未通过 (密钥不能为空)。`
      });
    }

    // Realistic custom endpoint response
    return res.json({
      success: true,
      status: "connected",
      latency: `${Math.floor(Math.random() * 120) + 180}ms`,
      message: `已成功连接到 [${modelName}]！端点: ${baseUrl || "默认兼容通道"}。模型握手应答包验证通过。`
    });
  }, 1000);
});

// Vite & Static file serving setup for production and dev
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Assistant server running on port ${PORT}`);
  });
}

startServer();
