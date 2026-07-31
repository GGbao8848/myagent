"""PostgreSQL 会话 & 消息持久化。

使用 psycopg2 连接平台的 PostgreSQL（br_platform 库），独立表 agent_sessions / agent_messages。
保留原有接口结构（create_session / list_sessions / save_message 等），调用方无需改动。
"""

from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor

from src.config import PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER


def _now() -> str:
    """返回 ISO 8601 格式的当前 UTC 时间（含毫秒，确保排序精度）。"""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class Database:
    """会话 & 消息 PostgreSQL 持久化。

    用法:
        db = Database()
        sid = db.create_session()
        sessions = db.list_sessions()
        db.save_message(sid, "user", "你好")
        db.delete_session(sid)
    """

    def __init__(self, db_path=None) -> None:
        # db_path 兼容旧接口（SQLite 迁移），实际使用 PG 配置
        with self._conn() as conn:
            self._init_schema(conn)

    # ------------------------------------------------------------------
    # 会话 CRUD
    # ------------------------------------------------------------------

    def create_session(self, title: str = "新对话", user_id: str = "") -> str:
        """创建新会话，返回 session_id。"""
        sid = uuid.uuid4().hex[:16]
        now = _now()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO agent_sessions (id, title, user_id, created_at, updated_at) VALUES (%s, %s, %s, %s, %s)",
                (sid, title, user_id, now, now),
            )
        return sid

    def list_sessions(self, user_id: str = "", limit: int = 50) -> list[dict[str, Any]]:
        """列出当前用户的最近会话，返回摘要列表。"""
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT s.id, s.title, s.message_count, s.created_at, s.updated_at,
                          (SELECT LEFT(m.content, 100) FROM agent_messages m
                           WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
                   FROM agent_sessions s
                   WHERE s.user_id = %s
                   ORDER BY s.updated_at DESC LIMIT %s""",
                (user_id, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_session(self, session_id: str, user_id: str = "") -> dict[str, Any] | None:
        """获取单个会话详情（含消息列表），校验用户归属。"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, title, message_count, created_at, updated_at FROM agent_sessions WHERE id = %s AND user_id = %s",
                (session_id, user_id),
            ).fetchone()
            if row is None:
                return None
            result = dict(row)
            msgs = conn.execute(
                "SELECT id, role, content, metadata, created_at FROM agent_messages WHERE session_id = %s ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
            result["messages"] = []
            for m in msgs:
                msg = dict(m)
                if msg.get("metadata"):
                    try:
                        msg["metadata"] = json.loads(msg["metadata"])
                    except json.JSONDecodeError:
                        msg["metadata"] = None
                else:
                    msg["metadata"] = None
                result["messages"].append(msg)
            return result

    def update_session(self, session_id: str, title: str, user_id: str = "") -> bool:
        """更新会话标题（校验用户归属）。"""
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE agent_sessions SET title = %s, updated_at = %s WHERE id = %s AND user_id = %s",
                (title, _now(), session_id, user_id),
            )
            return cur.rowcount > 0

    def delete_session(self, session_id: str, user_id: str = "") -> bool:
        """删除会话及其所有消息（CASCADE，校验用户归属）。"""
        with self._conn() as conn:
            cur = conn.execute(
                "DELETE FROM agent_sessions WHERE id = %s AND user_id = %s",
                (session_id, user_id),
            )
            return cur.rowcount > 0

    def session_exists(self, session_id: str, user_id: str = "") -> bool:
        """检查会话是否存在（校验用户归属）。"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM agent_sessions WHERE id = %s AND user_id = %s",
                (session_id, user_id),
            ).fetchone()
            return row is not None

    # ------------------------------------------------------------------
    # 消息
    # ------------------------------------------------------------------

    def save_message(
        self, session_id: str, role: str, content: str, metadata: dict | None = None
    ) -> int:
        """保存一条消息，可选附带 metadata（JSON 序列化），返回消息 ID。"""
        meta_json = json.dumps(metadata or {}, ensure_ascii=False)
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO agent_messages (session_id, role, content, metadata, created_at) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (session_id, role, content, meta_json, _now()),
            )
            mid = cur.fetchone()["id"]
            conn.execute(
                "UPDATE agent_sessions SET message_count = message_count + 1, updated_at = %s WHERE id = %s",
                (_now(), session_id),
            )
            return mid

    def get_messages(self, session_id: str) -> list[dict[str, str]]:
        """获取会话的所有消息，返回 langchain 兼容格式（含 metadata）。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT role, content, metadata FROM agent_messages WHERE session_id = %s ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
        result = []
        for r in rows:
            msg = {"role": r["role"], "content": r["content"]}
            if r["metadata"]:
                try:
                    msg["metadata"] = json.loads(r["metadata"])
                except json.JSONDecodeError:
                    pass
            result.append(msg)
        return result

    def get_message_count(self, session_id: str) -> int:
        """获取会话的消息数量。"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT message_count FROM agent_sessions WHERE id = %s", (session_id,)
            ).fetchone()
            return row["message_count"] if row else 0

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    def _init_schema(self, conn) -> None:
        """创建数据库表结构。"""
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS agent_sessions (
                    id            TEXT PRIMARY KEY,
                    title         TEXT NOT NULL DEFAULT '新对话',
                    user_id       TEXT NOT NULL DEFAULT '',
                    created_at    TEXT NOT NULL,
                    updated_at    TEXT NOT NULL,
                    message_count INTEGER NOT NULL DEFAULT 0,
                    metadata      TEXT NOT NULL DEFAULT '{}'
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS agent_messages (
                    id         SERIAL PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
                    role       TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
                    content    TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    tokens     INTEGER NOT NULL DEFAULT 0,
                    metadata   TEXT NOT NULL DEFAULT '{}'
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_id, created_at)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated ON agent_sessions(updated_at DESC)"
            )

    @contextmanager
    def _conn(self):
        """获取 PostgreSQL 连接，自动提交/关闭。"""
        conn = psycopg2.connect(
            host=PG_HOST,
            port=PG_PORT,
            user=PG_USER,
            password=PG_PASSWORD,
            dbname=PG_DATABASE,
            cursor_factory=RealDictCursor,
        )
        try:
            yield _ConnProxy(conn)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def close(self) -> None:
        """兼容接口：psycopg2 连接在 _conn contextmanager 中已自动关闭。"""
        pass


class _ConnProxy:
    """让 psycopg2 连接支持 conn.execute(...) 语法（自动创建 cursor）。"""

    def __init__(self, conn):
        self._conn = conn

    def cursor(self, *args, **kwargs):
        return self._conn.cursor(*args, **kwargs)

    def execute(self, sql, params=None):
        cur = self._conn.cursor()
        cur.execute(sql, params)
        return cur
