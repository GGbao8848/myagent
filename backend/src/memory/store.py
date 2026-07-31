"""SQLite 会话 & 消息持久化。

零外部依赖，仅使用 Python 内置 sqlite3 模块。
WAL 模式，支持并发读；外键级联删除。
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now() -> str:
    """返回 ISO 8601 格式的当前 UTC 时间（含毫秒，确保排序精度）。"""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class Database:
    """会话 & 消息 SQLite 持久化。

    用法:
        db = Database("data/br-agent.db")
        sid = db.create_session()
        sessions = db.list_sessions()
        db.save_message(sid, "user", "你好")
        db.delete_session(sid)
    """

    def __init__(self, db_path: str | Path) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # 首次连接即建表
        with self._conn() as conn:
            self._init_schema(conn)

    # ------------------------------------------------------------------
    # 会话 CRUD
    # ------------------------------------------------------------------

    def create_session(self, title: str = "新对话") -> str:
        """创建新会话，返回 session_id。"""
        sid = uuid.uuid4().hex[:16]
        now = _now()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (sid, title, now, now),
            )
        return sid

    def list_sessions(self, limit: int = 50) -> list[dict[str, Any]]:
        """列出最近的会话，返回摘要列表。"""
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT s.id, s.title, s.message_count, s.created_at, s.updated_at,
                          (SELECT SUBSTR(m.content, 1, 100) FROM messages m
                           WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
                   FROM sessions s ORDER BY s.updated_at DESC LIMIT ?""",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        """获取单个会话详情（含消息列表）。"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, title, message_count, created_at, updated_at FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if row is None:
                return None
            result = dict(row)
            msgs = conn.execute(
                "SELECT id, role, content, metadata, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC",
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

    def update_session(self, session_id: str, title: str) -> bool:
        """更新会话标题。"""
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
                (title, _now(), session_id),
            )
            return cur.rowcount > 0

    def delete_session(self, session_id: str) -> bool:
        """删除会话及其所有消息（CASCADE）。"""
        with self._conn() as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            cur = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            return cur.rowcount > 0

    def session_exists(self, session_id: str) -> bool:
        """检查会话是否存在。"""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM sessions WHERE id = ?", (session_id,)
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
                "INSERT INTO messages (session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?)",
                (session_id, role, content, meta_json, _now()),
            )
            conn.execute(
                "UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE id = ?",
                (_now(), session_id),
            )
            return cur.lastrowid

    def get_messages(self, session_id: str) -> list[dict[str, str]]:
        """获取会话的所有消息，返回 langchain 兼容格式（含 metadata）。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT role, content, metadata FROM messages WHERE session_id = ? ORDER BY created_at ASC",
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
                "SELECT message_count FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
            return row["message_count"] if row else 0

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    def _init_schema(self, conn: sqlite3.Connection) -> None:
        """创建数据库表结构，含向前兼容迁移。"""
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id            TEXT PRIMARY KEY,
                title         TEXT NOT NULL DEFAULT '新对话',
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0,
                metadata      TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS messages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role       TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
                content    TEXT NOT NULL,
                created_at TEXT NOT NULL,
                tokens     INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_messages_session
                ON messages(session_id, created_at);

            CREATE INDEX IF NOT EXISTS idx_sessions_updated
                ON sessions(updated_at DESC);
        """)
        # 向前兼容：已有 DB 可能缺少 metadata 列
        try:
            conn.execute("ALTER TABLE messages ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'")
        except sqlite3.OperationalError:
            pass  # 列已存在

    @contextmanager
    def _conn(self):
        """获取数据库连接，自动提交/关闭。"""
        conn = sqlite3.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def close(self) -> None:
        """显式关闭（sqlite3 连接在 _conn contextmanager 中已自动关闭）。"""
        pass
