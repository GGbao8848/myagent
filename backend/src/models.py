"""API 数据模型 — Pydantic v2 请求/响应类型定义。"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ==========================================================================
# 请求模型
# ==========================================================================


class CreateSessionRequest(BaseModel):
    """创建新会话。"""
    title: str | None = Field(None, description="会话标题，省略则自动生成")


class ChatRequest(BaseModel):
    """发送聊天消息。"""
    message: str = Field(..., min_length=1, description="用户消息内容")


class UpdateSessionRequest(BaseModel):
    """更新会话标题。"""
    title: str = Field(..., min_length=1, max_length=200, description="新标题")


class UpdateProfileRequest(BaseModel):
    """手动添加或调整用户观察。"""
    content: str = Field(..., min_length=1, description="观察内容")
    source: str = Field("explicit", description="来源: explicit | inferred | conversation")
    confidence: float = Field(0.8, ge=0.0, le=1.0, description="置信度 0~1")


class UpdateObservationRequest(BaseModel):
    """调整已有观察的置信度。"""
    confidence: float = Field(..., ge=0.0, le=1.0, description="新置信度")


class DeleteObservationRequest(BaseModel):
    """删除观察。"""
    observation_id: str = Field(..., description="观察 ID")


# ==========================================================================
# 响应模型
# ==========================================================================


class MessageItem(BaseModel):
    """单条消息。"""
    id: int
    role: str          # user | assistant | system | tool
    content: str
    metadata: dict | None = None   # thinking/tool_steps 等过程数据
    created_at: str    # ISO 8601


class SessionSummary(BaseModel):
    """会话摘要（列表视图）。"""
    id: str
    title: str
    message_count: int
    created_at: str
    updated_at: str
    last_message: str | None = None  # 最后一条消息的前 100 字符


class SessionDetail(BaseModel):
    """会话详情（含全部消息）。"""
    id: str
    title: str
    message_count: int
    created_at: str
    updated_at: str
    messages: list[MessageItem]


class DeleteResult(BaseModel):
    """删除操作结果。"""
    deleted: bool = True


class SkillInfo(BaseModel):
    """技能信息。"""
    id: str
    name: str
    description: str
    disabled: bool = False


class SkillToggleRequest(BaseModel):
    """启用/禁用技能。"""
    disabled: bool


class SkillUploadResult(BaseModel):
    """技能上传结果。"""
    skill_id: str
    skill: dict


class ObservationItem(BaseModel):
    """一条用户观察。"""
    id: str
    content: str
    source: str
    confidence: float
    created_at: str
    last_seen_at: str
    seen_count: int


class ProfileData(BaseModel):
    """用户画像数据。"""
    observations: list[ObservationItem] = []
    summary: str = ""
    updated_at: str = ""


class ProfileStats(BaseModel):
    """画像统计信息。"""
    total_observations: int = 0
    by_source: dict = {}
    avg_confidence: float = 0.0
    by_confidence: dict = {}


class ProfileUpdateSummary(BaseModel):
    """画像更新摘要。"""
    new_observations: list[ObservationItem] = []
    updated_count: int = 0
    summary: str = ""


# ==========================================================================
# MCP 模型
# ==========================================================================


class MCPServerAddRequest(BaseModel):
    """添加 MCP 服务器 — 支持完整 JSON 字符串或结构化对象。"""
    config_json: str | None = Field(None, description="完整的 mcpServers JSON 字符串")
    id: str | None = Field(None, description="服务器 ID")
    name: str | None = Field(None)
    type: str = "streamablehttp"
    url: str | None = None
    headers: dict[str, str] | None = None


class MCPServerItem(BaseModel):
    """MCP 服务器信息。"""
    id: str
    name: str
    type: str
    url: str = ""
    enabled: bool = True
    connected: bool = False
    tool_count: int = 0
    tools: list[dict] = []
    error: str = ""


class MCPTestResult(BaseModel):
    """MCP 连接测试结果。"""
    server_id: str
    connected: bool
    tools: list[dict] = []
    tool_count: int = 0
    error: str = ""


# ==========================================================================
# 远程 Tool 注册模型
# ==========================================================================


class RemoteToolInput(BaseModel):
    """外部 Tool 注册请求 — 符合 Tool 标准规范。"""
    name: str = Field(..., min_length=1, description="Tool 唯一名称（英文标识）")
    description: str = Field(..., min_length=1, description="Tool 功能描述")
    endpoint: str = Field(..., description="Tool HTTP 调用端点")
    version: str = Field("1.0.0", description="语义化版本号")
    inputSchema: dict = Field(default_factory=lambda: {"type": "object", "properties": {}},
                              description="输入参数 JSON Schema")


class RemoteToolItem(BaseModel):
    """已注册的远程 Tool 信息（含运行时状态）。"""
    name: str
    description: str
    endpoint: str
    version: str = "1.0.0"
    enabled: bool = True
    healthy: bool = True
