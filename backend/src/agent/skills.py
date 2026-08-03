"""Skill 发现、加载与管理。"""

from __future__ import annotations

import shutil

import yaml

from src.config import SKILLS_DIR


def _parse_skill(skill_md_path):
    """解析 SKILL.md frontmatter，返回 (skill_id, name, desc, disabled)。"""
    skill_id = skill_md_path.parent.name
    name = skill_id
    desc = ""
    disabled = False

    content = skill_md_path.read_text(encoding="utf-8")
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            try:
                fm = yaml.safe_load(parts[1]) or {}
                name = fm.get("name", skill_id)
                desc = fm.get("description", "")
                disabled = fm.get("disabled", False)
            except Exception:
                pass

    return skill_id, name, desc, disabled


def list_skills(show_all: bool = False) -> str:
    """列出可用技能。当用户提到任务时，应先调用此工具查看。

    Args:
        show_all: 为 True 时列出全部技能（含已禁用），默认只列启用的。
    """
    if not SKILLS_DIR.exists():
        return "当前没有可用技能。"

    lines: list[str] = []
    for skill_file in sorted(SKILLS_DIR.rglob("SKILL.md")):
        skill_id, name, desc, disabled = _parse_skill(skill_file)

        if disabled and not show_all:
            continue

        tag = " [已禁用]" if disabled else ""
        lines.append(f"- **{name}** (`{skill_id}`): {desc}{tag}")

    if not lines:
        return "当前没有可用技能。"
    return "\n".join(lines)


def load_skill(skill_id: str) -> str:
    """加载指定技能的完整说明文档（已去除元数据头）。应先调用 list_skills 获取可用的 skill_id，再按需加载。

    文档头部会包含该 skill 的根目录路径（SKILL_DIR）、可用脚本列表和可直接执行的命令模板。
    Agent 无需通过 `ls` 或 `glob` 自行查找脚本位置，直接复制命令即可执行。"""
    skill_md = SKILLS_DIR / skill_id / "SKILL.md"
    if not skill_md.exists():
        return f"技能 '{skill_id}' 不存在。请先调用 list_skills 查看可用技能列表。"

    content = skill_md.read_text(encoding="utf-8")
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            content = parts[2]

    skill_dir = str(skill_md.parent.resolve())

    # 在 MSYS2 / Git Bash 环境下统一用正斜杠
    import os as _os
    _is_msys = "MSYSTEM" in _os.environ or "MINGW" in _os.environ.get("MSYSTEM", "")
    if _is_msys:
        skill_dir = skill_dir.replace("\\", "/")

    # ---- 发现可用脚本 ----
    scripts_info = _discover_scripts(skill_md.parent)

    # ---- 构建精确的 header ----
    header_lines = [
        f"> **SKILL_DIR**: `{skill_dir}`",
        f"> 所有脚本路径均相对于此目录。",
    ]

    if scripts_info:
        header_lines.append("> ")
        header_lines.append("> **可用脚本**（直接复制执行，无需探索目录）：")
        for s in scripts_info:
            header_lines.append(f"> ```bash")
            header_lines.append(f"> python {s['path']} {s['args_hint']}")
            header_lines.append(f"> ```")
            if s.get("desc"):
                header_lines.append(f">   {s['desc']}")
    else:
        header_lines.append("> ")
        header_lines.append(f"> **执行任意脚本**:")
        header_lines.append(f"> ```bash")
        header_lines.append(f"> python {skill_dir}/scripts/<脚本名>.py [参数]")
        header_lines.append(f"> ```")

    header_lines.append("")
    header = "\n".join(header_lines)
    return header + content.strip()


def _discover_scripts(skill_dir: Path) -> list[dict]:
    """扫描 skill 目录下的 scripts/ 子目录，返回可用脚本列表。

    每个条目包含:
        path:   脚本的绝对路径（已根据当前 Shell 环境规范化分隔符）
        args_hint: 从脚本 argparse 中提取的参数提示（或 "--help 查看用法"）
        desc:   脚本 docstring 第一行（如果有）
    """
    import os as _os

    scripts_dir = skill_dir / "scripts"
    if not scripts_dir.is_dir():
        return []

    # 在 MSYS2 / Git Bash 环境下，路径统一用正斜杠
    _is_msys = "MSYSTEM" in _os.environ or "MINGW" in _os.environ.get("MSYSTEM", "")

    results: list[dict] = []
    for py_file in sorted(scripts_dir.glob("*.py")):
        if py_file.name.startswith("_"):
            continue
        try:
            raw = py_file.read_text(encoding="utf-8")
        except Exception:
            continue

        # 提取 docstring 第一行作为描述
        desc = _extract_docstring_summary(raw)

        # 尝试从 argparse 提取参数提示
        args_hint = _extract_args_hint(raw)

        path_str = str(py_file)
        if _is_msys:
            path_str = path_str.replace("\\", "/")

        results.append({
            "path": path_str,
            "args_hint": args_hint,
            "desc": desc,
        })

    return results


def _extract_docstring_summary(source: str) -> str:
    """从 Python 源码中提取模块级 docstring 的第一行。"""
    import ast
    try:
        tree = ast.parse(source)
        doc = ast.get_docstring(tree)
        if doc:
            return doc.strip().split("\n")[0]
    except SyntaxError:
        pass
    return ""


def _extract_args_hint(source: str) -> str:
    """从 Python 源码中提取 argparse 定义的参数名，作为参数提示。

    返回类似 \"--submitted --date 2024-01-01\" 的字符串，
    或 \"--help 查看用法\"（无法推断时）。
    """
    import re

    # 检测是否使用了 argparse
    has_argparse = bool(re.search(r"argparse|ArgumentParser|add_argument", source))
    if not has_argparse:
        return "--help 查看用法"

    # 提取所有 add_argument 的位置参数和可选参数
    flags = []
    for m in re.finditer(
        r"\.add_argument\s*\(\s*['\"](--?[\w-]+)['\"]",
        source,
    ):
        flag = m.group(1)
        # 跳过 --help 这种通用 flag
        if flag not in ("--help", "-h"):
            flags.append(flag)

    if flags:
        return " ".join(flags[:6]) + (" ..." if len(flags) > 6 else "")
    return "--help 查看用法"


# ------------------------------------------------------------------
# 管理操作（供 API 调用）
# ------------------------------------------------------------------


def set_skill_disabled(skill_id: str, disabled: bool) -> bool:
    """启用或禁用一个 skill（修改 SKILL.md 的 frontmatter）。"""
    skill_md = SKILLS_DIR / skill_id / "SKILL.md"
    if not skill_md.exists():
        return False

    content = skill_md.read_text(encoding="utf-8")
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            try:
                fm = yaml.safe_load(parts[1]) or {}
            except Exception:
                return False
            fm["disabled"] = disabled
            new_frontmatter = yaml.dump(fm, allow_unicode=True, default_flow_style=False).strip()
            new_content = f"---\n{new_frontmatter}\n---{parts[2]}"
            skill_md.write_text(new_content, encoding="utf-8")
            return True
    return False


def delete_skill(skill_id: str, owner: str = "") -> bool:
    """删除一个 skill（删除整个 skill 目录）。owner 指定时仅删私有技能。"""
    base_dir = SKILLS_DIR if not owner else get_user_skills_dir(owner)
    skill_dir = base_dir / skill_id
    if not skill_dir.exists() or not (skill_dir / "SKILL.md").exists():
        return False
    shutil.rmtree(skill_dir)
    # 同步删除 PG 元数据
    try:
        from src.api.deps import get_db
        get_db().delete_skill(skill_id, owner)
    except Exception:
        pass
    return True


def get_user_skills_dir(user_id: str):
    """获取用户私有技能目录。"""
    from src.config import PROJECT_ROOT
    return PROJECT_ROOT / "data" / "skills" / user_id


def list_skills_raw(show_all: bool = False, owner: str = "") -> list[dict]:
    """返回技能列表（公共 + 当前用户私有）。"""
    result: list[dict] = []

    def _scan(base_dir, is_private: bool):
        if not base_dir.exists():
            return
        for skill_file in sorted(base_dir.rglob("SKILL.md")):
            skill_id, name, desc, disabled = _parse_skill(skill_file)
            if disabled and not show_all:
                continue
            result.append({
                "id": skill_id,
                "name": name,
                "description": desc,
                "disabled": disabled,
                "is_custom": is_private,
                "owner": owner if is_private else "",
            })

    # 公共技能
    _scan(SKILLS_DIR, is_private=False)
    # 当前用户私有技能
    if owner:
        _scan(get_user_skills_dir(owner), is_private=True)

    # 与 PG 元数据同步（首次扫描时录入，保持 id/名称一致）
    try:
        from src.api.deps import get_db
        db = get_db()
        for s in result:
            db.save_skill({
                "id": s["id"], "name": s["name"], "description": s["description"],
                "category": "custom" if s["is_custom"] else "document",
                "owner": s["owner"], "enabled": not s["disabled"], "is_custom": s["is_custom"],
            })
    except Exception:
        pass  # 元数据同步失败不影响列表展示

    return result


def install_skill_from_zip(zip_data: bytes, skill_id: str | None = None, owner: str = "") -> tuple[str, dict]:
    """从 zip 字节流安装 skill。

    要求 zip 内必须包含 SKILL.md（可以嵌套在一层目录中）。
    owner='' 安装为公共技能，owner=user_id 安装为用户私有技能。
    返回 (skill_id, skill_info_dict)。
    """
    import io
    import zipfile
    from pathlib import Path

    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        # 找到 SKILL.md
        skill_md_path = None
        for name in zf.namelist():
            if name.endswith("SKILL.md") and "/.git/" not in name and "__pycache__" not in name:
                depth = name.count("/")
                if name.rstrip("/").endswith("SKILL.md"):
                    parts = name.rstrip("/").split("/")
                    if parts[-1] == "SKILL.md":
                        skill_md_path = name
                        break

        if skill_md_path is None:
            raise ValueError("zip 中未找到 SKILL.md，请确保压缩包包含有效的技能目录")

        # 读取 SKILL.md 获取 skill_id
        md_content = zf.read(skill_md_path).decode("utf-8")
        extracted_id = _extract_skill_id(skill_md_path, md_content)
        final_id = skill_id if skill_id else extracted_id

        # 确定 zip 根前缀
        prefix = skill_md_path.rsplit("SKILL.md", 1)[0]

        # 目标目录（公共或私有）
        base_dir = SKILLS_DIR if not owner else get_user_skills_dir(owner)
        target_dir = base_dir / final_id
        if target_dir.exists():
            raise FileExistsError(f"技能 '{final_id}' 已存在，请先删除后再上传")

        target_dir.mkdir(parents=True, exist_ok=True)

        # 解压同目录下的所有文件
        for name in zf.namelist():
            if not name.startswith(prefix) or name == prefix:
                continue
            rel = name[len(prefix):]
            if not rel or rel.startswith(".git/") or "__pycache__" in rel:
                continue
            dest = target_dir / rel
            if name.endswith("/"):
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(zf.read(name))

        # 写入 SKILL.md（确保 frontmatter 正确）
        target_md = target_dir / "SKILL.md"
        target_md.write_text(md_content, encoding="utf-8")

    _, name, desc, disabled = _parse_skill(target_md)
    info = {
        "id": final_id,
        "name": name,
        "description": desc,
        "disabled": disabled,
        "is_custom": bool(owner),
        "owner": owner,
    }
    # 同步元数据到 PG
    try:
        from src.api.deps import get_db
        db = get_db()
        db.save_skill({
            "id": final_id, "name": name, "description": desc,
            "category": "custom" if owner else "document",
            "owner": owner, "enabled": not disabled, "is_custom": bool(owner),
        })
    except Exception:
        pass
    return final_id, info


def _extract_skill_id(md_path: str, content: str) -> str:
    """从 SKILL.md 内容或路径提取 skill_id。"""
    # 先尝试 YAML frontmatter
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            try:
                fm = yaml.safe_load(parts[1]) or {}
                if fm.get("name"):
                    return fm["name"]
            except Exception:
                pass

    # fallback: 取父目录名
    return Path(md_path).parent.name or "unknown-skill"

