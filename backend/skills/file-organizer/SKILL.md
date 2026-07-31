---
name: file-organizer
description: 智能文件整理——根据文件名将文件自动分类到指定文件夹。当用户提到"整理文件"、"文件分类"、"按类别整理"、"归类文件"、"整理文件夹"、"文件自动分类"，或描述将文件按类型/类别分到不同目录的需求时，务必使用此技能，即使用户没有明确说"整理"二字。
---

# 智能文件整理

## 概述

根据文件名和目录结构，利用 AI 判断将文件自动分类复制到目标文件夹。原始文件保持不变。

**适配小模型（32K 上下文）**：AI 只处理几十行摘要，产出分类规则；Python 负责扫描、规则匹配、复制等大量操作。

## 架构

```
┌─ Python 执行（确定性，不消耗 AI 上下文）───────────────────┐
│                                                          │
│  scan → summarize → apply_rules → apply_mapping         │
│   ↑                     ↑                               │
│   全量扫描          AI 规则批量匹配（处理几万条也不怕）     │
│                                                          │
│  AI 介入点：只读 summary（~500 tokens），产出 rules       │
│  ┌─────────────────────────────────────────────┐        │
│  │ summary: { 目录分布, 扩展名统计, 150条样本 }  │        │
│  │           ↓  AI 分析                         │        │
│  │ rules:  [{path_contains, category}, ...]     │        │
│  └─────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────┘
```

## 完整流程（5 步，全命令行）

**所有临时文件（inventory.json / summary.json / rules.json / mapping.json）放在项目目录，不是 skill 目录。**

### 步骤 ①：扫描

```bash
python "<skill-root>/scripts/organize.py" scan "E:/源目录" "E:/源目录/inventory.json"
```

### 步骤 ②：汇总 → AI 可读摘要

```bash
python "<skill-root>/scripts/organize.py" summarize "E:/源目录/inventory.json" "E:/源目录/summary.json"
```

生成的 `summary.json` 结构（~500-1000 tokens，小模型轻松读完）：

```json
{
  "total": 6334,
  "dirs": [
    {"path": "02_3D设计/02_最新3D/01_夹具类", "file_count": 2649},
    {"path": "01_项目接收资料/02 产品数模", "file_count": 1516}
  ],
  "extensions": [
    {"ext": ".catpart", "count": 3200},
    {"ext": ".dwg", "count": 150}
  ],
  "samples": [
    {"name": "BRS25134-BP78&79-LAYOUT-1-00.dwg", "parent_dirs": ["05_签发资料", "05_系统布局图"]},
    {"name": "采购件.xlsx", "parent_dirs": ["01_项目接收资料", "07 项目外购件"]}
  ]
}
```

### 步骤 ③：AI 分析 summary → 产出 rules.json

**AI 读取 `summary.json`**，根据目录结构、文件名样本、扩展名分布，写出分类规则。

规则格式（按数组顺序匹配，前面的优先）：

```json
[
  {"path_contains": "夹具",              "category": "工装设计加工进度表"},
  {"path_contains": "3d-layout",         "category": "焊装线工艺优化方案"},
  {"path_contains": "07 项目外购件",      "category": "外购件汇总表"},
  {"path_contains": "08 项目标准件",      "category": "设备标准件图册"},
  {"name_contains": "PFMEA",             "category": "PFMEA"},
  {"name_contains": "技术协议",           "category": "焊装线工艺优化方案"},
  {"name_contains": "颜色标准",           "category": "电气方案安全方案"},
  {"suffix_in": [".dwg", ".dxf"],        "category": "设备总图装配图"},
  {"suffix_in": [".catpart", ".catproduct", ".stp"], "category": "设备总图装配图"}
]
```

规则字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `path_contains` | string | rel_path 中含此字符串则匹配（大小写不敏感） |
| `name_contains` | string | 文件名中含此字符串则匹配（大小写不敏感） |
| `suffix_in` | [string] | 扩展名在此列表中则匹配 |
| `category` | string | 匹配后归入的分类名（**必需**，必须与用户给的分类列表一致） |

一条规则可组合多个字段（AND 逻辑）。文件命中第一条规则即停止匹配。未命中的自动归入"其他"。

**AI 写 rules.json**：

```bash
# AI 用 Write 工具直接写出，放到项目目录（不是 skill 目录！）
# 路径: E:/源目录/rules.json
```

### 步骤 ④：Python 用规则批量匹配

```bash
python "<skill-root>/scripts/organize.py" rules "E:/源目录/inventory.json" "E:/源目录/rules.json" "工装设计加工进度表,焊装线工艺优化方案,外购件汇总表,..." "E:/源目录/mapping.json"
```

这一步 Python 自动完成，几万条文件几秒内处理完。stdout 输出 mapping.json，stderr 输出统计摘要。

### 步骤 ⑤：确认并执行复制

**将统计结果展示给用户确认**，确认后执行：

```bash
python "<skill-root>/scripts/organize.py" apply "E:/源目录" "E:/源目录_已整理" "分类A,分类B,分类C,..." "E:/源目录/mapping.json"
```

自动输出完整报告（含空分类缺口清单）。

完成后，询问用户是否需要清理临时文件（`inventory.json` / `summary.json` / `rules.json` / `mapping.json`）。

## AI 写规则的策略指南

看到 `summary.json` 后，按以下优先级写规则：

### 1. 从 `dirs` 推断（权重最高）

目录名本身就是最强的分类信号。对每个文件数 > 10 的目录路径，判断其语义：

| 目录含 | 通常指向 |
|--------|---------|
| `夹具`、`抓手`、`置台` | 工装类 |
| `layout`、`布置` | 布局/方案类 |
| `气路`、`气动` | 气动原理图 |
| `仿真`、`simulation` | 仿真类 |
| `外购`、`询价` | 外购件汇总 |
| `标准件` | 标准件图册 |
| `电气`、`HMI` | 电气原理图/方案 |
| `机器人`、`robot` | 机器人相关 |

规则写法：`{"path_contains": "<目录关键词>", "category": "<匹配的分类名>"}`

### 2. 从 `samples` 推断（权重中）

看样本文件名中的关键词。中文关键词优先级最高，英文缩写其次（PFMEA、PLC、OLP、BOM）。编号模式（如 `2101210XBP79A-05`）没有语义，不要为它写规则。

### 3. 从 `extensions` 兜底（权重最低）

扩展名只能提供大类线索（.dwg → 图纸类，.xlsx → 清单类），无法区分具体分类。**只在 path_contains 和 name_contains 都覆盖不到时使用**。

### 4. 写规则原则

- **规则排在前面的优先**，path_contains 规则放最前面
- **一个规则尽量覆盖一批文件**，不要为单个文件写规则
- **suffix_in 规则放最后**，作为兜底
- **不确定的不要强行匹配**，未命中的文件自动归入"其他"

## 铁律

1. **skill 目录只读**——所有临时 JSON 文件放用户的项目目录，不是 skill 目录
2. **不要写分类脚本**——`organize.py` 已包含所有确定性操作。AI 只产出 `rules.json`
3. **确认后再执行复制**——`apply` 命令会实际复制文件，执行前先将统计结果展示给用户确认
4. **规则 > 逐条映射**——产出 20 条规则（200 tokens），而不是 6000 条逐文件映射（500K tokens）

## Python API（内存模式，≤ 200 文件时可选）

```python
import sys
sys.path.insert(0, r"<skill-root>/scripts")
from organize import scan_files, summarize_inventory, apply_rules, apply_mapping, format_report

# ① 扫描
files = scan_files(source_dir)        # list[dict]

# ② 汇总 → AI
summary = summarize_inventory(files)  # dict，可直接打印给 AI 看

# ③ AI 分析后写出 rules（AI 做，不是 Python）
rules = [
    {"path_contains": "夹具", "category": "工装"},
    {"name_contains": "报告", "category": "文档"},
    {"suffix_in": [".dwg"],  "category": "图纸"},
]

# ④ 规则匹配
mapping = apply_rules(rules, files, categories)

# ⑤ 复制
result = apply_mapping(source_dir, output_dir, categories, mapping)
print(format_report(result))
```

## 触发语示例

- "帮我整理 C:\Users\me\Downloads 到 文档、图片、安装包 文件夹"
- "整理桌面文件，分成 工作、个人、临时"
- "将 E:\项目 按这58个分类整理"
- "把这个目录里的文件按类别整理一下"

## 边界情况

- **空目录**：`scan_files()` 自动跳过
- **权限问题**：跳过并记录，报告中列出
- **超大文件**（>500MB）：`apply_mapping` 会尝试复制，Python 报错会记录在 skipped 中
- **非法字符**：文件夹名中的 `/` `:` 等自动替换为全角版本
- **子目录结构**：默认保留（`preserve_structure=True`），可通过参数改为扁平化
