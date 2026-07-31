"""用户画像 — 数字分身。

设计理念：
  画像不是表单，而是"对用户的一系列观察记忆"。
  每条观察是自然语言的事实片段，随对话自然生长：
    - 新的观察被添加
    - 重复出现的观察置信度上升
    - 长期未出现的观察置信度衰减
    - 矛盾的观察被标记和替换

不绑定任何特定 skill——无论用户做什么、聊什么，画像都在进化。
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _ts() -> float:
    return time.time()


# ==========================================================================
# 数据模型
# ==========================================================================


@dataclass
class Observation:
    """一条关于用户的观察记忆。

    自然语言表达，如 "用户偏好简洁的代码风格，不喜欢过多注释"。
    """

    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    content: str = ""                     # 自然语言事实
    source: str = "conversation"         # conversation | inferred | explicit | system
    confidence: float = 0.5              # 0.0 ~ 1.0
    created_at: str = field(default_factory=_now)
    last_seen_at: str = field(default_factory=_now)
    seen_count: int = 1

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "content": self.content,
            "source": self.source,
            "confidence": self.confidence,
            "created_at": self.created_at,
            "last_seen_at": self.last_seen_at,
            "seen_count": self.seen_count,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Observation":
        return cls(
            id=d.get("id", uuid.uuid4().hex[:8]),
            content=d.get("content", ""),
            source=d.get("source", "conversation"),
            confidence=d.get("confidence", 0.5),
            created_at=d.get("created_at", _now()),
            last_seen_at=d.get("last_seen_at", _now()),
            seen_count=d.get("seen_count", 1),
        )


# ==========================================================================
# 画像管理器
# ==========================================================================


class UserProfile:
    """用户数字分身。

    存储格式 (JSON):
        {
          "observations": [
            {"id": "abc123", "content": "用户偏好简洁直接的回复", "confidence": 0.85, ...},
            ...
          ],
          "summary": "自动生成的一句话摘要",
          "updated_at": "2026-06-26T15:30:00"
        }

    用法:
        p = UserProfile()
        p.observe("用户偏好简洁的代码风格", source="inferred", confidence=0.6)
        p.observe("用户叫张三", source="explicit", confidence=1.0)
        text = p.summary_text()  # 注入 system prompt
    """

    # 配置
    CONFIDENCE_DECAY_PER_DAY = 0.05      # 每天衰减 5%
    CONFIDENCE_BOOST_ON_REPEAT = 0.1     # 重复出现提升 10%
    MAX_OBSERVATIONS = 100               # 最多保留条数
    SIMILARITY_THRESHOLD = 0.6           # 视为重复的相似度阈值
    MIN_CONFIDENCE_FOR_SUMMARY = 0.3     # 低于此值的观察不进入摘要

    def __init__(self, path: str | Path | None = None) -> None:
        if path is None:
            from src.config import PROFILE_PATH
            path = PROFILE_PATH
        self._path = Path(path)
        self._observations: list[Observation] = []
        self._summary: str = ""
        self._updated_at: str = ""
        self._dirty = False
        self._load()

    # ------------------------------------------------------------------
    # 公共 API
    # ------------------------------------------------------------------

    def observe(
        self,
        content: str,
        *,
        source: str = "conversation",
        confidence: float = 0.5,
    ) -> Observation | None:
        """记录一条关于用户的新观察。

        如果与已有观察高度相似，则提升已有观察的置信度而非新增。
        返回新增或被更新的观察。
        """
        content = content.strip()
        if not content or len(content) < 3:
            return None

        # 找最相似的已有观察
        existing = self._find_similar(content)
        if existing:
            # 提升置信度
            existing.confidence = min(
                1.0,
                existing.confidence + self.CONFIDENCE_BOOST_ON_REPEAT,
            )
            existing.seen_count += 1
            existing.last_seen_at = _now()
            existing.source = source  # 更新来源（可能从 inferred 升级为 explicit）
            self._dirty = True
            self._save()
            return existing

        # 新观察
        obs = Observation(
            content=content,
            source=source,
            confidence=min(confidence, 0.9),  # 新观察最高 0.9，需要重复确认才到 1.0
        )
        self._observations.append(obs)
        self._prune()
        self._dirty = True
        self._save()
        return obs

    def forget(self, observation_id: str) -> bool:
        """手动删除一条观察。"""
        before = len(self._observations)
        self._observations = [o for o in self._observations if o.id != observation_id]
        if len(self._observations) < before:
            self._dirty = True
            self._save()
            return True
        return False

    def get_observations(
        self,
        min_confidence: float = 0.0,
        limit: int | None = None,
    ) -> list[Observation]:
        """获取观察列表，按置信度降序。"""
        obs = [o for o in self._observations if o.confidence >= min_confidence]
        obs.sort(key=lambda o: (o.confidence, o.seen_count), reverse=True)
        if limit:
            obs = obs[:limit]
        return obs

    def summary_text(self) -> str:
        """生成可注入 system prompt 的画像摘要。

        这是 agent 在每次对话开头看到的"关于用户的一切"。
        """
        self._apply_decay()

        active = self.get_observations(min_confidence=self.MIN_CONFIDENCE_FOR_SUMMARY)
        if not active:
            return ""

        # 按来源和置信度分组
        explicit = [o for o in active if o.source == "explicit" and o.confidence >= 0.7]
        high_conf = [o for o in active if o.confidence >= 0.7 and o not in explicit]
        medium_conf = [o for o in active if 0.4 <= o.confidence < 0.7]

        lines: list[str] = []
        lines.append("以下是你对当前用户的了解（数字分身）。这些信息来自对话中的观察，置信度越高越可靠：")
        lines.append("")

        if explicit:
            lines.append("✅ 用户明确告知：")
            for o in explicit:
                lines.append(f"  • {o.content}")
            lines.append("")

        if high_conf:
            lines.append("🔵 高置信度推断：")
            for o in high_conf:
                lines.append(f"  • {o.content}")
            lines.append("")

        if medium_conf and len(medium_conf) <= 5:
            lines.append("🟡 可能的相关信息：")
            for o in medium_conf:
                lines.append(f"  • {o.content}")
            lines.append("")

        lines.append("请在对话中自然地运用这些信息，但不要刻意引用。如果发现矛盾，以用户最新说法为准。")

        return "\n".join(lines)

    def merge_observations(self, new_observations: list[dict]) -> list[Observation]:
        """合并 MemoryAgent 提取的观察（替换原正则提取）。

        每项 dict 包含 content, source, confidence 字段。
        通过 observe() 去重合并，自动更新置信度。
        """
        results: list[Observation] = []
        for item in new_observations:
            obs = self.observe(
                content=item["content"],
                source=item.get("source", "conversation"),
                confidence=item.get("confidence", 0.5),
            )
            if obs:
                results.append(obs)
        if results:
            self._update_summary()
        return results

    def set_observation_confidence(self, obs_id: str, confidence: float) -> bool:
        """手动调整一条观察的置信度。"""
        for o in self._observations:
            if o.id == obs_id:
                o.confidence = max(0.0, min(1.0, confidence))
                self._dirty = True
                self._save()
                return True
        return False

    def get_data(self) -> dict[str, Any]:
        """返回完整画像数据（供 API 使用）。"""
        self._apply_decay()
        return {
            "observations": [o.to_dict() for o in self._observations],
            "summary": self._summary or self._build_summary(),
            "updated_at": self._updated_at,
        }

    def get_stats(self) -> dict[str, Any]:
        """返回画像统计信息。"""
        self._apply_decay()
        sources = {"explicit": 0, "inferred": 0, "conversation": 0, "system": 0}
        for o in self._observations:
            sources[o.source] = sources.get(o.source, 0) + 1
        return {
            "total_observations": len(self._observations),
            "by_source": sources,
            "avg_confidence": (
                sum(o.confidence for o in self._observations) / len(self._observations)
                if self._observations
                else 0
            ),
            "by_confidence": {
                "high": len([o for o in self._observations if o.confidence >= 0.7]),
                "medium": len([o for o in self._observations if 0.4 <= o.confidence < 0.7]),
                "low": len([o for o in self._observations if o.confidence < 0.4]),
            },
        }

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    def _find_similar(self, content: str) -> Observation | None:
        """查找与给定内容最相似的已有观察。"""
        best_match: Observation | None = None
        best_score = 0.0

        for o in self._observations:
            score = _text_similarity(content, o.content)
            if score > best_score:
                best_score = score
                best_match = o

        if best_score >= self.SIMILARITY_THRESHOLD:
            return best_match
        return None

    def _apply_decay(self) -> None:
        """对长期未出现的观察应用置信度衰减。"""
        now_ts = _ts()
        decay_applied = False

        for o in self._observations:
            # 跳过显式声明的观察（用户明确说过的不过期）
            if o.source == "explicit":
                continue
            # 只衰减超过 3 天未出现的
            try:
                last_dt = datetime.fromisoformat(o.last_seen_at)
                days = (now_ts - last_dt.timestamp()) / 86400
            except (ValueError, OSError):
                continue
            if days > 3:
                decay = self.CONFIDENCE_DECAY_PER_DAY * (days - 3)
                old_conf = o.confidence
                o.confidence = max(0.1, o.confidence - decay)
                if o.confidence != old_conf:
                    decay_applied = True

        if decay_applied:
            self._dirty = True
            self._save()

        # 清理置信度过低且从未重复的观察
        self._observations = [
            o for o in self._observations
            if not (o.confidence < 0.15 and o.seen_count == 1)
        ]

    def _prune(self) -> None:
        """保留最有价值的观察，移除冗余的。"""
        if len(self._observations) <= self.MAX_OBSERVATIONS:
            return

        # 按 (置信度 * seen_count) 排序，保留top
        scored = sorted(
            self._observations,
            key=lambda o: o.confidence * o.seen_count,
            reverse=True,
        )
        self._observations = scored[: self.MAX_OBSERVATIONS]

    def _update_summary(self) -> None:
        """更新一句话摘要。"""
        self._summary = self._build_summary()

    def _build_summary(self) -> str:
        """从观察中生成一句话摘要。"""
        high = [o.content for o in self._observations if o.confidence >= 0.7]
        if not high:
            medium = [o.content for o in self._observations if o.confidence >= 0.5]
            if not medium:
                return "尚未充分了解用户。"
            high = medium

        # 取前 3 条高置信度观察拼接
        snippets = high[:3]
        return "；".join(snippets) + "。"

    def _load(self) -> None:
        """从文件加载画像数据。"""
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                self._observations = [
                    Observation.from_dict(d) for d in data.get("observations", [])
                ]
                self._summary = data.get("summary", "")
                self._updated_at = data.get("updated_at", "")
                # 加载时应用一次衰减
                self._apply_decay()
            except (json.JSONDecodeError, OSError, TypeError):
                self._observations = []
                self._summary = ""
        else:
            self._observations = []
            self._summary = ""

    def _save(self) -> None:
        """保存画像到文件。"""
        if not self._dirty:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._updated_at = _now()
        data = {
            "observations": [o.to_dict() for o in self._observations],
            "summary": self._summary or self._build_summary(),
            "updated_at": self._updated_at,
        }
        self._path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self._dirty = False


def _text_similarity(a: str, b: str) -> float:
    """计算两个文本的简单相似度（基于共同字符的 Jaccard 系数）。"""
    set_a = set(a)
    set_b = set(b)
    if not set_a or not set_b:
        return 0.0
    intersection = set_a & set_b
    union = set_a | set_b
    return len(intersection) / len(union)
