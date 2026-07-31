"""
文件整理核心工具 — 跨平台文件扫描、汇总、规则匹配、复制、报告。

专为小模型设计的分层架构：
  scan_files()          → Python: 全量扫描
  summarize_inventory() → Python: 压缩为 AI 可读摘要（<1000 tokens）
  AI 读摘要             → AI: 产出分类规则 rules
  apply_rules()         → Python: 规则批量匹配 → mapping
  apply_mapping()       → Python: 执行复制 + 报告

所有函数基于 pathlib + shutil，Windows / Linux / macOS 行为一致。
"""
import json
import shutil
from collections import Counter
from pathlib import Path


# ═══════════════════════════════════════════════════════════
# 第一步：扫描
# ═══════════════════════════════════════════════════════════

def scan_files(source_dir: str | Path) -> list[dict]:
    """递归扫描源目录，每项含 path/name/stem/suffix/size/rel_path/parent_dirs。"""
    source = Path(source_dir).resolve()
    if not source.exists():
        raise FileNotFoundError(f"源目录不存在: {source}")
    if not source.is_dir():
        raise NotADirectoryError(f"源路径不是目录: {source}")

    files = []
    for f in source.rglob("*"):
        if not f.is_file():
            continue
        try:
            rel = f.relative_to(source)
        except ValueError:
            continue
        files.append({
            "path": str(f),
            "name": f.name,
            "stem": f.stem,
            "suffix": f.suffix.lower(),
            "size": f.stat().st_size,
            "rel_path": str(rel).replace("\\", "/"),
            "parent_dirs": [p for p in rel.parent.parts if p],
        })
    return files


# ═══════════════════════════════════════════════════════════
# 第二步：汇总 → 压缩为 AI 可读摘要
# ═══════════════════════════════════════════════════════════

def summarize_inventory(files: list[dict], sample_limit: int = 150) -> dict:
    """
    将全量 inventory 压缩为 AI 可读的摘要（~500-1000 tokens）。

    摘要结构:
      total: 文件总数
      dirs:  [{path, file_count}, ...]          按文件数降序
      extensions: [{ext, count}, ...]            按文件数降序
      samples: [{name, suffix, rel_path, parent_dirs}, ...]  代表性样本

    样本优先选取非纯数字/编号命名的文件（更有语义信息）。
    """
    # 目录统计
    dir_counter: Counter = Counter()
    for f in files:
        for i in range(1, len(f["parent_dirs"]) + 1):
            dir_counter["/".join(f["parent_dirs"][:i])] += 1

    dirs = [
        {"path": d, "file_count": c}
        for d, c in dir_counter.most_common(60)
    ]

    # 扩展名统计
    ext_counter = Counter(f["suffix"] for f in files)
    extensions = [
        {"ext": e, "count": c}
        for e, c in ext_counter.most_common(20)
    ]

    # 样本选取：优先选有语义的文件名（含中文/英文关键词，非纯编号）
    def _is_semantic(f: dict) -> bool:
        name_no_ext = f["stem"]
        # 含中文 → 高语义
        if any('一' <= c <= '鿿' for c in name_no_ext):
            return True
        # 含英文字母（非纯数字/下划线/短横）→ 中等语义
        alpha = sum(1 for c in name_no_ext if c.isalpha())
        digit = sum(1 for c in name_no_ext if c.isdigit())
        return alpha > digit * 2 and len(name_no_ext) > 4

    semantic = [f for f in files if _is_semantic(f)]
    numeric = [f for f in files if not _is_semantic(f)]

    # 每种子目录至少取 1 个样本
    seen_dirs = set()
    samples = []
    for f in semantic + numeric:
        d = "/".join(f["parent_dirs"])
        if d not in seen_dirs or len(samples) < sample_limit:
            if d not in seen_dirs:
                seen_dirs.add(d)
            if len(samples) < sample_limit:
                samples.append({
                    "name": f["name"],
                    "suffix": f["suffix"],
                    "rel_path": f["rel_path"],
                    "parent_dirs": f["parent_dirs"],
                })

    return {
        "total": len(files),
        "dirs": dirs,
        "extensions": extensions,
        "samples": samples[:sample_limit],
    }


# ═══════════════════════════════════════════════════════════
# 第三步（AI 执行）：读 summary，产出分类规则
# ═══════════════════════════════════════════════════════════
#
# AI 看到的是几十行摘要（目录分布 + 扩展名 + 样本文件名），
# 而不是几千行逐文件清单。AI 产出的是 human-readable 的规则列表：
#
# rules = [
#   {"path_contains": "夹具",              "category": "工装设计加工进度表"},
#   {"path_contains": "layout",            "category": "焊装线工艺优化方案"},
#   {"name_contains": "pfmea",             "category": "PFMEA"},
#   {"suffix_in": [".dwg", ".dxf"],        "category": "图纸"},
#   {"name_contains": "技术协议",           "category": "焊装线工艺优化方案"},
#   ...
# ]
#
# 规则按数组顺序匹配——排前面的优先级更高。
# ═══════════════════════════════════════════════════════════


# ═══════════════════════════════════════════════════════════
# 第四步：Python 用规则批量匹配
# ═══════════════════════════════════════════════════════════

def apply_rules(
    rules: list[dict],
    files: list[dict],
    categories: list[str],
) -> dict[str, str]:
    """
    用 AI 产出的规则列表，批量匹配全部文件 → 产出 mapping。

    规则字段（均为可选，组合使用）:
      path_contains:  str  — rel_path 中包含此字符串则匹配
      name_contains:  str  — 文件名中包含此字符串则匹配
      suffix_in:      list — 扩展名在此列表中则匹配
      category:       str  — 匹配后归入的分类名（必需）

    匹配逻辑：规则按数组顺序逐条匹配。文件命中第一条规则就归入该分类，
    命中多条时取第一条（优先级高者排前面）。未命中任何规则的文件归入"其他"。

    返回: {rel_path: category, ...}
    """
    mapping: dict[str, str] = {}
    cat_set = set(categories)

    for f in files:
        matched = False
        for rule in rules:
            cat = rule.get("category", "其他")
            if cat not in cat_set and cat != "其他":
                continue

            # path_contains 匹配
            if "path_contains" in rule:
                kw = rule["path_contains"].lower()
                if kw not in f["rel_path"].lower():
                    continue

            # name_contains 匹配
            if "name_contains" in rule:
                kw = rule["name_contains"].lower()
                if kw not in f["name"].lower():
                    continue

            # suffix_in 匹配
            if "suffix_in" in rule:
                if f["suffix"] not in [s.lower() for s in rule["suffix_in"]]:
                    continue

            # 全部条件通过 → 匹配成功
            mapping[f["rel_path"]] = cat
            matched = True
            break

        if not matched:
            mapping[f["rel_path"]] = "其他"

    return mapping


# ═══════════════════════════════════════════════════════════
# 第五步：根据 mapping 执行复制
# ═══════════════════════════════════════════════════════════

def apply_mapping(
    source_dir: str | Path,
    output_dir: str | Path,
    categories: list[str],
    mapping: dict[str, str],
    preserve_structure: bool = True,
) -> dict:
    """根据 mapping 将文件复制到输出目录。保留子目录结构。"""
    source = Path(source_dir).resolve()
    output = Path(output_dir).resolve()

    all_cats = list(categories)
    if "其他" not in all_cats:
        all_cats.append("其他")

    for cat in all_cats:
        (output / _sanitize(cat)).mkdir(parents=True, exist_ok=True)

    stats: dict[str, int] = {cat: 0 for cat in all_cats}
    skipped: list[dict] = []

    for rel_path_str, category in mapping.items():
        src_file = source / rel_path_str
        safe_cat = _sanitize(category if category in all_cats else "其他")

        dest = output / safe_cat / rel_path_str if preserve_structure else output / safe_cat / src_file.name
        dest.parent.mkdir(parents=True, exist_ok=True)

        try:
            shutil.copy2(str(src_file), str(dest))
            stats[safe_cat] += 1
        except (PermissionError, OSError) as e:
            skipped.append({"path": str(src_file), "reason": str(e)})

    stats["_output"] = str(output)
    stats["_skipped"] = skipped
    stats["_total"] = sum(v for k, v in stats.items() if not k.startswith("_"))
    stats["_empty_cats"] = [c for c in all_cats if stats.get(c, 0) == 0]

    return stats


# ═══════════════════════════════════════════════════════════
# 报告
# ═══════════════════════════════════════════════════════════

def format_report(stats: dict) -> str:
    """将 apply_mapping 的返回结果格式化为可读报告。"""
    output = stats.get("_output", "未知")
    total = stats.get("_total", 0)
    skipped = stats.get("_skipped", [])
    empty_cats = stats.get("_empty_cats", [])

    lines = [
        "=" * 60,
        "📊 文件整理完成！",
        f"输出目录：{output}",
        f"总文件数：{total}",
        "",
        "分类统计：",
    ]

    for cat, count in sorted(stats.items(), key=lambda x: -x[1]):
        if cat.startswith("_"):
            continue
        bar = "█" * min(count // 10, 40) if count > 0 else ""
        lines.append(f"  📁 {count:>5}  {cat}  {bar}")

    lines.append("")

    if empty_cats:
        lines.append(f"⚠️ {len(empty_cats)} 个分类为空（源目录中未找到匹配文件）：")
        for c in empty_cats:
            lines.append(f"  ❌ {c}")
        lines.append("")

    if skipped:
        lines.append(f"🚫 跳过 {len(skipped)} 个文件：")
        for s in skipped[:10]:
            lines.append(f"  - {s['path']}：{s['reason']}")
        lines.append("")

    lines.append("原始文件未做任何修改。")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════
# JSON 文件读写（桥接 Python ↔ AI）
# ═══════════════════════════════════════════════════════════

def save_json(data, path: str | Path) -> Path:
    """保存数据为 JSON 文件。"""
    p = Path(path)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return p

def load_json(path: str | Path):
    """从 JSON 文件加载数据。"""
    return json.loads(Path(path).read_text(encoding="utf-8"))


# ═══════════════════════════════════════════════════════════
# 工具
# ═══════════════════════════════════════════════════════════

def _sanitize(name: str) -> str:
    """替换文件名中的非法字符为全角版本。"""
    for old, new in {"/": "／", "\\": "＼", ":": "：", "*": "＊",
                     "?": "？", "<": "＜", ">": "＞", "|": "｜", "\"": "＂"}.items():
        name = name.replace(old, new)
    return name


# ═══════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("用法:")
        print("  python organize.py scan <源目录> [输出json]          # 扫描 → inventory.json")
        print("  python organize.py summarize <inventory.json>         # 汇总 → summary.json（给 AI 读）")
        print("  python organize.py rules <inventory.json> <rules.json> <分类列表>  # 规则匹配 → mapping.json")
        print("  python organize.py apply <源目录> <输出目录> <分类列表> <mapping.json>  # 复制")
        print()
        print("完整流程:")
        print("  1. python organize.py scan E:/项目 inv.json")
        print("  2. python organize.py summarize inv.json > summary.json")
        print("  3. AI 读 summary.json → 写出 rules.json")
        print("  4. python organize.py rules inv.json rules.json \"分类A,分类B\" > mapping.json")
        print("  5. python organize.py apply E:/项目 E:/项目_已整理 \"分类A,分类B\" mapping.json")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "scan":
        src = sys.argv[2]
        out = sys.argv[3] if len(sys.argv) > 3 else "inventory.json"
        files = scan_files(src)
        save_json(files, out)
        print(f"✅ 扫描 {len(files)} 个文件 → {out}")

    elif cmd == "summarize":
        inv_path = sys.argv[2]
        out = sys.argv[3] if len(sys.argv) > 3 else None
        files = load_json(inv_path)
        summary = summarize_inventory(files)
        if out:
            save_json(summary, out)
            print(f"✅ 汇总 {summary['total']} 个文件 → {out}  ({len(summary['dirs'])} 目录, {len(summary['samples'])} 样本)")
        else:
            print(json.dumps(summary, ensure_ascii=False, indent=2))

    elif cmd == "rules":
        inv_path = sys.argv[2]
        rules_path = sys.argv[3]
        cats = [c.strip() for c in sys.argv[4].split(",")]
        out = sys.argv[5] if len(sys.argv) > 5 else None
        files = load_json(inv_path)
        rules = load_json(rules_path)
        mapping = apply_rules(rules, files, cats)
        if out:
            save_json(mapping, out)
        else:
            print(json.dumps(mapping, ensure_ascii=False, indent=2))
        # 简要统计
        from collections import Counter
        dist = Counter(mapping.values())
        print(f"✅ 规则匹配完成：{dict(dist)}", file=sys.stderr)

    elif cmd == "apply":
        src = sys.argv[2]
        out_dir = sys.argv[3]
        cats = [c.strip() for c in sys.argv[4].split(",")]
        mapping = load_json(sys.argv[5])
        result = apply_mapping(src, out_dir, cats, mapping)
        print(format_report(result))

    else:
        print(f"未知命令: {cmd}，可用: scan | summarize | rules | apply")
