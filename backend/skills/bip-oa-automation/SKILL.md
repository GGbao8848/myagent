---
description: BIP OA 自动化 — 发票上传+OCR识别+FAP台账创建+费用报销提交
disabled: true
name: bip-oa-automation
---

# BIP OA 自动化

脚本入口：`scripts/` 目录（`login.py`、`config.py` 已从报工 skill 复用）。

> ⚠️ 绝对不要重写或重新创建这些脚本文件，直接 import 使用。
> ⚠️ 所有模式内部已含登录，不要拆成多步。

## 意图 → 命令映射

| 用户说 | 执行 | 追问条件 |
|---|---|---|
| 只提供凭据，未提具体操作 | 追问意图 | 缺凭据 |
| "报销" / "提交报销"（未指定参数） | 追问 | 缺发票文件、出差申请单 |
| "上传发票" / "识别发票" | 上传 → OCR → 创建 FAP 台账 | 缺发票文件 |
| "查发票台账" | 查询 FAP 列表 | — |

**凭据优先级**：`-u -p` > `BIP_USERNAME`/`BIP_PASSWORD` 环境变量 > 追问。

## 参数

### 必填

| 参数 | 说明 |
|---|---|
| 发票文件 | 要上传的发票图片/PDF |
| 出差申请单号 | `srcDocNo`，如 `CXS26050555` |
| 项目号 | `ProjectID`，从出差申请单或 BIP 查询获取 |

### 可选

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--dry-run` | false | 仅生成 payload，不提交 |

## 完整流程

```
1. 登录 → 从 Cookie 解析 CompanyID、EmpID
2. 上传发票文件 → 拿到 FileUrl
3. OCR 识别 → 拿到 InvcNo/InvcAmt/VendorName 等
4. 创建 FAP 发票台账 (OA600100 mode=1) → 拿到 FAP DocNo
5. 查询 FAP 台账 → 确认 DocNo，建立原始发票→FAP 映射
6. 查询报销人银行卡 + 出差申请单
7. 构建费用明细（每行 InvcNo 填 FAP DocNo，非原始发票号）
8. 提交报销单 (OA600000 mode=1) → 返回 DocNo
```

## 发票分类

| 特征关键词 | FeeID | 
|---|---|
| 住宿/酒店/宾馆 | ADT01 |
| 飞机/航空/行程单 | ADT0301 |
| 出租车/网约车/滴滴 | ADT0302 |
| 火车/铁路 | ADT0306 |
| 加油/汽油/停车 | ADT04 |
| 通行费/过路费/过桥费 | ADT0304 |
| 差旅津贴 | ADT06 |
| 其他交通 | ADT0307 |

## 核心规则

### 编码（最重要）

- `Content-Type` 必须用 `application/x-www-form-urlencoded`，**不能带 charset**
- XML 声明统一 `encoding="UTF-8"`
- `urlencode(params).encode("utf-8")`，不要用 GBK
- 中文只放在 XML 属性值中，顶层参数不包含中文
- XML 属性值必须转义：`& < > " '`
- FileUrl JSON 放进 XML 属性时双引号变为 `&quot;`

### FAP 发票台账

- 明细 `InvcNo` **必须填 FAP DocNo**（如 `FAP-20260610-0049`），不能填原始发票号
- 创建 FAP 时必须写 `InvcName`（不是 `PurchaserName`）
- FAP 创建后 mode=2 更新 `InvcName` 无效，必须删除重建
- mode=3 删除是软删除，发票号仍被占用

### 其他

- 不猜测项目号/ProjectID，找不到直接报错
- 不允许硬编码默认账号密码，登录过期弹框重登
- 接口返回 Ret≠1 立即报错，不静默吞掉
- 每一条费用明细都要关联对应的 FAP DocNo
- 提交前校验：金额合计、FAP 关联、必填字段

## 费用类型参考

| FeeID | 说明 | 需要发票 |
|------|------|:--:|
| ADT01 | 住宿 | ✅ |
| ADT0301 | 飞机 | ✅ |
| ADT0302 | 出租车/网约车 | ✅ |
| ADT0304 | 过路费/过桥费 | ✅ |
| ADT04 | 油费 | 可选（可关联行程单） |
| ADT06 | 差旅津贴 | ❌ |

## 参考

- `references/api-spec.md` — 报销相关 API 端点
- `references/invoice-ocr-integration.md` — OCR 接口细节
- `references/expense-reimbursement-form.md` — 报销单字段详解
- `references/multi-invoice-reimbursement.md` — 多发票报销指南
- `references/cxb-submission-flow.md` — CXB 提交流程
- `references/driving-record-integration.md` — 行程单/油费集成
- `references/upload-mechanism.md` — 文件上传机制
- `references/invoice-extraction-patterns.md` — 发票提取模式
