# 发票 OCR 识别集成

## 概述

发票上传到 BIP 后，需调用 OCR 识别接口提取发票结构化数据。BIP 系统通过 EDI 适配器（bip.br-robot.com）转发到第三方 OCR 服务。

## 两种调用方式

### 方式 A：通过 Vue $syncApi 调用（推荐，浏览器上下文）

在浏览器控制台中，可直接使用 Vue 实例的 `$syncApi.invoiceOCR()` 方法：

```javascript
// 获取 zsorcs 参数
var zsorcs = sessionStorage.getItem('zsorcs') || 'zs';

// 构建 billAddrs
var billAddrs = [
  { fileAddr: '/doc/2026/06/09/xxx/油费发票.pdf', templateSign: '', invcType: '' },
  { fileAddr: '/doc/2026/06/09/xxx/去程过路费1.pdf', templateSign: '', invcType: '' }
];

// 调用 OCR（方式 1：通过 Vue 实例）
var app = document.querySelector('#app').__vue_app__;
// 找到挂载了 $syncApi 的组件实例
var vm = app._instance;
// 或直接通过 window 上的全局变量
if (window._syncApi) {
  window._syncApi.invoiceOCR(JSON.stringify(billAddrs), zsorcs, function(resp) {
    console.log('OCR result:', resp);
  });
}
```

### 方式 B：通过 EDI 适配器 HTTP API（Python/curl 可用）

```bash
POST http://bip.br-robot.com/ediadapter/{zsorcs}/query
Content-Type: application/x-www-form-urlencoded

handle=bip
apiurl=/receipt/multipleInvoice
billAddrs=[{"fileAddr":"/doc/2026/06/09/xxx/发票.pdf","templateSign":"","invcType":""}]
_ENCODE_=UTF-8
```

```python
import requests

zsorcs = 'zs'  # 从 sessionStorage 获取或默认
bill_addrs = [{"fileAddr": path, "templateSign": "", "invcType": ""}]

resp = requests.post(
    f'http://bip.br-robot.com/ediadapter/{zsorcs}/query',
    data={
        'handle': 'bip',
        'apiurl': '/receipt/multipleInvoice',
        'billAddrs': json.dumps(bill_addrs, ensure_ascii=False),
        '_ENCODE_': 'UTF-8'
    }
)
result = resp.json()
```

## zsorcs 参数获取

`zsorcs` 是 EDI 适配器的路由参数，可通过以下方式获取：

### 方式 1：sessionStorage（推荐，浏览器上下文）
```javascript
var zsorcs = sessionStorage.getItem('zsorcs');
// 通常返回 "zs"
```

### 方式 2：通过 queryform 查询
```javascript
// 查询 AM300802D 模板
POST /powerbip/queryform.do
参数: trancode=AM300802D, mode=4, DocType=AM300802D, CompanyID=BRS1
```

## OCR 返回结果字段

| 字段 | 说明 | 示例 |
|------|------|------|
| InvcDate | 开票日期 | 2026-05-29 |
| InvcAmt | 价税合计金额 | 190.01 |
| InvcAmtBC | 本币金额 | 190.01 |
| InvcType | 发票类型代码 | 004 |
| InvcID | 发票代码 | 310023... |
| InvcNo | 发票号码 | 12345678 |
| VendorName | 销售方名称 | 上海迪尚酒店 |
| PurchaserName | 购买方名称 | 江苏北人智能制造科技股份有限公司 |
| TaxAmt | 税额 | 10.76 |
| NetInvcAmt | 不含税金额 | 179.25 |
| DeductionTaxAmt | 可抵扣税额 | 10.76 |
| CheckStatus | 查验状态 (1=通过) | 1 |
| FileUrl | 文件路径 | /doc/2026/06/09/xxx/发票.pdf |
| Details | 发票明细(JSON) | [...] |

### 发票类型 (InvcType) 映射

| 代码 | 说明 |
|------|------|
| 004 | 增值税电子普通发票 |
| 007 | 增值税电子专用发票 |
| 008 | 通行费电子发票 |
| 010 | 增值税普通发票(纸质) |
| 026 | 全电发票(普通) |
| others | 非发票(水单/小票等) |

## 多发票批量识别

OCR 接口支持一次传入多张发票：

```javascript
var billAddrs = [
  { fileAddr: '/doc/2026/06/09/xxx/发票1.pdf', templateSign: '', invcType: '' },
  { fileAddr: '/doc/2026/06/09/xxx/发票2.pdf', templateSign: '', invcType: '' },
  // ...最多建议 10-20 张
];
```

返回结果数组与传入顺序一致。

## 识别后的数据处理

OCR 返回后，需要：

1. **过滤非发票**（InvcType === 'others' 的为水单/小票，无金额）
2. **设置币种**：`item.InvcCurr = 'CNY'`
3. **计算本币金额**：`item.InvcAmtBC = item.InvcAmt`（人民币场景）
4. **提取发票号码**：用于费用明细的 `InvcNo` 字段
5. **关联文件路径**：`FileUrl` 用于费用明细的附件关联

## 注意事项

1. **zsorcs 过期**：如果 OCR 返回 404，可能是 zsorcs 参数过期，重新从 sessionStorage 获取
2. **EDI 适配器地址**：`bip.br-robot.com` 是外部服务，需网络可达（内外网均可访问）
3. **文件路径**：`fileAddr` 使用上传返回的服务器路径（如 `/doc/2026/06/09/xxx/发票.pdf`）
4. **编码**：请求使用 UTF-8 编码（`_ENCODE_=UTF-8`），非 GBK
5. **非发票文件**：水单/小票等非发票文件返回 `InvcType='others'`，金额为 0
