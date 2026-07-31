"""BR-Agent 应用入口 — Agent 生命周期管理 + CLI。

职责：
  - 启动时构建 Agent（一次构建，所有会话复用）
  - 管理每个会话的内存消息缓冲
  - 注入用户画像到 system prompt
  - 流式返回 SSE 事件
  - CLI 交互模式
"""

from __future__ import annotations

import logging
import re
import sys
import threading
from typing import Generator

from src.agent import build_agent
from src.config import DB_PATH, PROFILE_PATH, SYSTEM_PROMPT
from src.memory import Database, MemoryAgent, UserProfile

logger = logging.getLogger(__name__)

# tiktoken 编码器（延迟加载，cl100k_base 与 Qwen tokenizer 一致）
_tokenizer = None


def _get_tokenizer():
    global _tokenizer
    if _tokenizer is None:
        import tiktoken
        _tokenizer = tiktoken.get_encoding("cl100k_base")
    return _tokenizer


def _count_tokens(messages: list[dict], profile_text: str = "") -> int:
    """精确计算消息列表的 token 数（使用 cl100k_base 编码器）。"""
    enc = _get_tokenizer()
    total = 0
    # system prompt
    total += len(enc.encode(SYSTEM_PROMPT))
    # profile
    if profile_text:
        total += len(enc.encode(profile_text))
    # 每条消息（含 role 标记的开销 ~4 tokens）
    for m in messages:
        total += len(enc.encode(m.get("content", ""))) + 4
    return max(1, total)


class AgentManager:
    """单例 Agent 管理器。"""

    _instance: AgentManager | None = None

    def __init__(self, tool_manager=None) -> None:
        self._tool_manager = tool_manager
        self._rebuild_agent()
        self.db = Database(DB_PATH)
        self.profile = UserProfile(PROFILE_PATH)
        self._buffers: dict[str, list[dict]] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._cancel_lock = threading.Lock()

    @classmethod
    def get_instance(cls, tool_manager=None) -> "AgentManager":
        if cls._instance is None:
            cls._instance = cls(tool_manager=tool_manager)
        return cls._instance

    def _rebuild_agent(self) -> None:
        """(重新)构建 agent。"""
        self.agent, self.sandbox = build_agent(
            tool_manager=self._tool_manager
        )

    def sync_mcp_tools(self, new_mcp_tools: list) -> int:
        """动态更新 MCP 工具集并重建 agent。

        当 ToolManager 可用时，从 ToolManager 重新加载全部工具；
        否则使用传入的工具列表（兼容旧路径）。
        """
        if self._tool_manager is not None:
            # 通过 ToolManager 统一重新加载
            tools = self._tool_manager.get_langchain_tools()
            self._rebuild_agent()
            return len(tools)
        else:
            # 兼容路径：直接使用传入的 MCP 工具
            self._rebuild_agent()
            return len(new_mcp_tools)

    # ------------------------------------------------------------------
    # 会话消息缓冲
    # ------------------------------------------------------------------

    def get_messages(self, session_id: str) -> list[dict]:
        if session_id not in self._buffers:
            self._buffers[session_id] = self.db.get_messages(session_id)
        return self._buffers[session_id]

    def cancel_stream(self, session_id: str) -> bool:
        """取消指定会话正在进行的流式生成。

        返回 True 表示确实有正在运行的流被取消。
        """
        with self._cancel_lock:
            evt = self._cancel_events.get(session_id)
            if evt and not evt.is_set():
                evt.set()
                logger.info("AgentManager: 会话 %s 的流式生成已取消", session_id)
                return True
            return False

    def is_streaming(self, session_id: str) -> bool:
        """检查指定会话是否正在流式生成中。"""
        evt = self._cancel_events.get(session_id)
        return evt is not None and not evt.is_set()

    def clear_buffer(self, session_id: str) -> None:
        self._buffers.pop(session_id, None)

    # ------------------------------------------------------------------
    # 流式对话
    # ------------------------------------------------------------------

    def stream_chat(
        self, session_id: str, user_msg: str
    ) -> Generator[dict, None, None]:
        """同步生成器：逐 token 产出 SSE 事件字典。

        事件类型:
            thinking    — 思考/规划文本
            tool_call   — agent 决定调用工具
            tool_result — 工具执行结果
            done        — 回复完成
            error       — 出错
        """
        # ── 1. 准备输入 ──
        messages, full_input, cancel_evt, ctx_usage = self._prepare_input(
            session_id, user_msg,
        )
        yield ctx_usage

        # ── 2. 流式处理 ──
        gen = self._run_stream(full_input, cancel_evt)
        while True:
            try:
                yield next(gen)
            except StopIteration as e:
                timeline, cancelled = e.value
                break

        # 清理取消事件
        with self._cancel_lock:
            self._cancel_events.pop(session_id, None)

        # ── 3. 持久化 & 画像更新 ──
        yield from self._finalize_response(
            session_id, user_msg, messages, timeline, cancelled,
        )

    # ------------------------------------------------------------------
    # stream_chat 子步骤
    # ------------------------------------------------------------------

    def _prepare_input(
        self, session_id: str, user_msg: str,
    ) -> tuple[list[dict], list[dict], threading.Event, dict]:
        """准备流式输入：加载消息、注入画像、计数 token、注册取消事件。

        Returns:
            (messages, full_input, cancel_evt, context_usage_event)
        """
        messages = self.get_messages(session_id)

        # 动态注入用户画像
        profile_text = self.profile.summary_text()
        effective_msg = (
            f"{profile_text}\n\n---\n\n{user_msg}" if profile_text else user_msg
        )

        full_input = [
            *messages,
            {"role": "user", "content": effective_msg},
        ]

        # 上下文用量
        max_tokens = 32768
        try:
            from src.config.settings_store import get_active_provider
            p = get_active_provider()
            if p and p.get("maxContextTokens"):
                max_tokens = p["maxContextTokens"]
        except Exception:
            pass

        used_tokens = _count_tokens(full_input, profile_text)
        context_usage_event = {
            "event": "context_usage",
            "used_tokens": used_tokens,
            "max_tokens": max_tokens,
        }

        self.db.save_message(session_id, "user", user_msg)
        messages.append({"role": "user", "content": user_msg})

        # 注册取消事件
        cancel_evt = threading.Event()
        with self._cancel_lock:
            self._cancel_events[session_id] = cancel_evt

        return messages, full_input, cancel_evt, context_usage_event

    def _run_stream(
        self,
        full_input: list[dict],
        cancel_evt: threading.Event,
    ) -> Generator[dict, None, tuple[list[dict], bool]]:
        """驱动 agent.stream() 并处理每个 chunk。

        Returns:
            (timeline, cancelled)
        """
        from langchain_core.messages import ToolMessage

        timeline: list[dict] = []
        emitted_tool_ids: set = set()
        cancelled = False

        try:
            for chunk in self.agent.stream(
                {"messages": full_input}, stream_mode="messages",
                config={"recursion_limit": 50},
            ):
                if cancel_evt.is_set():
                    cancelled = True
                    break

                if not isinstance(chunk, tuple) or len(chunk) < 1:
                    continue

                msg = chunk[0]

                # ── 工具执行结果 ──
                if isinstance(msg, ToolMessage):
                    name = getattr(msg, 'name', 'unknown')
                    content = str(msg.content)[:500] if msg.content else ''
                    timeline.append({"type": "tool_result", "name": name, "content": content})
                    yield {
                        "event": "tool_result",
                        "tool_name": name,
                        "content": content,
                    }
                    continue

                # ── 文本内容 ──
                content = getattr(msg, 'content', '')
                if isinstance(content, str) and content:
                    clean = re.sub(r'</?think>', '', content)
                    if clean:
                        if timeline and timeline[-1]["type"] == "thinking":
                            timeline[-1]["content"] += clean
                        else:
                            timeline.append({"type": "thinking", "content": clean})
                        yield {"event": "thinking", "content": clean}

                # ── 工具调用 ──
                tool_calls = getattr(msg, 'tool_calls', None) or getattr(msg, 'tool_call_chunks', None)
                if tool_calls:
                    for tc in tool_calls:
                        yield from self._process_tool_call(tc, timeline, emitted_tool_ids)

        except Exception as e:
            yield {"event": "error", "content": str(e)}

        return timeline, cancelled

    @staticmethod
    def _process_tool_call(
        tc, timeline: list[dict], emitted_tool_ids: set,
    ) -> Generator[dict, None, None]:
        """处理单个 tool_call chunk（去重 / 增量更新 / 首次发射）。"""
        # 提取信息（兼容 dict 和 ToolCallChunk 对象）
        tc_name = tc.get('name', '') if isinstance(tc, dict) else getattr(tc, 'name', '')
        tc_id = tc.get('id', '') if isinstance(tc, dict) else getattr(tc, 'id', '')
        tc_args = tc.get('args', {}) if isinstance(tc, dict) else getattr(tc, 'args', {})

        if not tc_name and not tc_id:
            return

        dedup_key = tc_id or tc_name

        # 已发射过 — 增量更新
        if dedup_key in emitted_tool_ids:
            for i in range(len(timeline) - 1, -1, -1):
                if timeline[i]["type"] == "tool_call" and timeline[i].get("id") == tc_id:
                    if tc_args:
                        timeline[i]["args"] = {**timeline[i].get("args", {}), **tc_args}
                    if tc_name and timeline[i].get("name") != tc_name and timeline[i].get("name", "").startswith("call_"):
                        old_name = timeline[i]["name"]
                        timeline[i]["name"] = tc_name
                        yield {
                            "event": "tool_call_update",
                            "old_name": old_name,
                            "tool_name": tc_name,
                            "args": timeline[i].get("args", {}),
                        }
                    break
            return

        # 首次出现
        if not tc_name:
            tc_name = tc_id or 'unknown'
        emitted_tool_ids.add(dedup_key)
        timeline.append({"type": "tool_call", "name": tc_name, "args": tc_args, "id": tc_id})
        yield {"event": "tool_call", "tool_name": tc_name, "args": tc_args}

    def _finalize_response(
        self,
        session_id: str,
        user_msg: str,
        messages: list[dict],
        timeline: list[dict],
        cancelled: bool,
    ) -> Generator[dict, None, None]:
        """持久化回复、发射 done 事件、后台更新画像。"""
        # 清理 think 标签残留
        for item in timeline:
            if item["type"] == "thinking":
                item["content"] = re.sub(r'</?think>', '', item["content"]).strip()

        # 提取纯文本
        full_text = "\n\n".join(
            item["content"]
            for item in timeline
            if item["type"] == "thinking" and item.get("content")
        )

        process_meta = {"timeline": timeline} if timeline else {}

        if cancelled:
            if full_text.strip():
                self.db.save_message(session_id, "assistant",
                                     full_text + "\n\n> [已停止]",
                                     metadata=process_meta if process_meta else None)
            messages.append({"role": "assistant", "content": full_text})
            yield {"event": "done", "cancelled": True}
            return

        msg_id = self.db.save_message(session_id, "assistant", full_text,
                                       metadata=process_meta if process_meta else None)
        messages.append({"role": "assistant", "content": full_text})
        yield {"event": "done", "message_id": msg_id}

        # 后台异步提取用户观察
        def _update_profile() -> None:
            try:
                memory_agent = MemoryAgent()
                new_obs = memory_agent.run(
                    user_msg=user_msg,
                    assistant_msg=full_text,
                    profile=self.profile,
                )
                if new_obs:
                    logger.info("MemoryAgent: 提取 %d 条观察", len(new_obs))
            except Exception:
                logger.debug("MemoryAgent: 用户画像提取失败", exc_info=True)

        threading.Thread(target=_update_profile, daemon=True).start()

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------

    def cleanup(self) -> None:
        self.sandbox.cleanup()
        self._buffers.clear()


# ==========================================================================
# CLI 入口
# ==========================================================================


def main() -> None:
    """CLI 交互模式 — 使用 stream_chat() 以启用记忆更新 + DB 持久化。"""
    print("[BR-Agent] CLI mode (type 'quit' to exit)\n")

    try:
        manager = AgentManager()
    except RuntimeError as e:
        print(f"[ERROR] {e}")
        sys.exit(1)

    sid = manager.db.create_session("CLI")
    try:
        while True:
            try:
                user_input = input("You: ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\n👋 Goodbye!")
                break

            if user_input.lower() in ("quit", "exit", "q"):
                print("👋 Goodbye!")
                break

            if not user_input:
                continue

            print("\nAssistant: ", end="", flush=True)
            for event in manager.stream_chat(sid, user_input):
                if event["event"] == "token":
                    print(event["content"], end="", flush=True)
                elif event["event"] == "profile_update":
                    logger.info("CLI: 更新了 %d 条用户观察", event["count"])
            print("\n")
    finally:
        manager.cleanup()


if __name__ == "__main__":
    main()
