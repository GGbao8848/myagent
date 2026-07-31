# 差旅报销单 (CXB) 提交流程详解

## 概述

差旅报销单通过 `oprperform.do` API 提交，参数包含多个 XML 格式的 `xmldetails` 字段。提交前需先上传发票文件并完成 OCR 识别，然后构造费用明细和表单数据。

## 完整提交流程

```
① 上传发票文件 → 获取文件路径 (Path)
   ↓
② OCR 识别发票 → 获取结构化数据 (InvcNo, InvcAmt, etc.)
   ↓
③ 查询行车记录 → 获取油费补贴数据 (DRV2606000007)
   ↓
④ 构造表单数据 (form1 + form2 + paymentForm → mergedObj)
   ↓
⑤ 构造费用明细 (expenseDetails → xmldetails1)
   ↓
⑥ 构造冲借款明细 (loanWriteOff → xmldetails2)
   ↓
⑦ 提交 oprperform.do (mode=1, execmode='Audit')
```

## 提交参数结构

```javascript
// 从 BasicInfo.js 的 submitForm 方法提取
var mergedObj = Object.assign({}, form1, form2, paymentForm);

var params = {
  trancode: 'OA600000',
  mode: 1,                    // 1=新增
  DocType: 'CXB',             // 差旅报销单
  DocNo: '',                  // 新增时为空
  CompanyID: 'BRS1',
  execmode: 'Audit',          // 提交审批
  srccopied: submitType,      // 提交类型（见下方）
  xmldetails0: getXmlDetailsFromFrm(mergedObj),  // 主表单数据
  xmldetails1: getXmlDetailsFromList(expenseDetails),  // 费用明细
  xmldetails2: getXmlDetailsFromList(loanWriteOff),    // 冲借款明细
  xmldetailsr: '',            // 预留字段
  xmldetailsa: ''             // 预留字段
};
```

### submitType 取值

| 值 | 说明 |
|----|------|
| 'Submit' | 提交（默认） |
| 'Save' | 保存草稿 |
| 'Audit' | 提交审批（通过 execmode 控制） |

## 表单数据 (form1 + form2 + paymentForm)

> ⚠️ **实际提交时，所有字段合并到 xmldetails0 一个 XML 中**。form2（出差申请关联）和 paymentForm（支付信息）的字段不单独发送，而是与 form1 字段一起作为 xmldetails0 中 `<xmldetail>` 的属性。出差申请关联使用 srcDocNo/BeginDate/EndDate/BTDestination/BTReason 等字段；支付信息使用 BankDocNo/BankInfo 字段（非 PayType/BankName/BankAccount）。

### form1 — 基本信息

| 字段 | 说明 | 示例 |
|------|------|------|
| CreateUsr | 创建人ID | BRS1862 |
| EmpID | 员工ID | BRS1862 |
| CompanyID | 公司ID | BRS1 |
| OrgID | 部门ID |  |
| OrgName | 部门名称 |  |
| DocDate | 单据日期 | 2026-06-09 |
| DocDesc | 报销事由 | 上海出差报销 |
| MainProjectID | 项目名称(展示用) |  |
| ProjectID | 项目ID | BRS25905 |
| ProjectName | 项目名称 | 焊缝全断面质量可移动在线检测装备研制1-课题5自筹 |
| Curr | 币种 | CNY |
| PayoutAmt | 报销金额 | 1094.59 |
| PayoutAmtBC | 本币金额 | 1094.59 |
| ReportDesc | 报销说明 | 上海出差费用报销 |

### form2 — 业务相关信息

| 字段 | 说明 | 示例 |
|------|------|------|
| TravelAppNo | 关联出差申请编号 | （可选） |
| TravelEmp | 同行人员 | 曹旭 |
| TravelBeginDate | 出差开始日期 | 2026-05-29 |
| TravelEndDate | 出差结束日期 | 2026-06-01 |
| TravelDays | 出差天数 | 4 |
| TravelAddr | 出差地点 | 上海 |
| TravelReason | 出差事由 | 项目调试 |

### paymentForm — 支付信息

| 字段 | 说明 | 示例 |
|------|------|------|
| PayType | 支付方式 | 1（银行转账） |
| BankName | 开户银行 | 中国银行 |
| BankAccount | 银行账号 | 6217... |
| BankAccountName | 开户人 | 龙占全 |
| PayeeName | 收款人 | 龙占全 |

## 费用明细 (xmldetails1)

### 字段映射

| XML 属性 | 说明 | 示例 |
|----------|------|------|
| FeeID | 费用类型代码 | ADT01 |
| FeeDesc | 费用类型描述 | 住宿费 |
| RefDocBeginDate | 开始日期 | 2026-05-29 |
| RefDocEndDate | 结束日期 | 2026-06-01 |
| InvcNo | 发票号码(逗号分隔) | 310023...,310024... |
| FeeAmt | 含税金额 | 603.74 |
| FeeAmtBC | 本币金额 | 603.74 |
| Curr | 币种 | CNY |
| StartPoint | 出发地 | 苏州 |
| Destination | 目的地 | 上海 |
| FileUrl | 附件路径(JSON数组) | [{"FileName":"住宿发票.pdf","FileUrl":"/doc/.../..."}] |
| Rmrk | 费用事由 | 上海出差3晚住宿 |
| ProjectID | 成本归属项目ID | BRS25905 |
| DrivingRecordNo | 行车记录编号 | DRV2606000007 |
| ActualMileage | 实际里程 | 319.71 |
| SubAmt | 补贴金额 | 383.65 |
| RowNo | 行号 | 1 |

### 费用明细行示例

#### 住宿费 (ADT01)
```xml
<xmldetail FeeID="ADT01" FeeDesc="住宿费" RefDocBeginDate="2026-05-29" 
  RefDocEndDate="2026-06-01" InvcNo="310023xxx,310024xxx,310025xxx" 
  FeeAmt="603.74" FeeAmtBC="603.74" Curr="CNY" 
  Destination="上海" 
  FileUrl='[{"FileName":"第一天发票.pdf","FileUrl":"/doc/2026/06/09/xxx/第一天发票.pdf"},{"FileName":"第二天发票.pdf","FileUrl":"/doc/2026/06/09/xxx/第二天发票.pdf"},{"FileName":"第三天发票.pdf","FileUrl":"/doc/2026/06/09/xxx/第三天发票.pdf"}]'
  Rmrk="上海出差3晚住宿(5/29-6/1)" ProjectID="BRS25905" RowNo="1"/>
```

#### 过路费 (ADT0305)
```xml
<xmldetail FeeID="ADT0305" FeeDesc="其他交通" RefDocBeginDate="2026-05-29"
  RefDocEndDate="2026-06-01" InvcNo="3100xxx,3100xxx,3100xxx,3100xxx,3100xxx"
  FeeAmt="107.20" FeeAmtBC="107.20" Curr="CNY"
  StartPoint="苏州" Destination="上海"
  FileUrl='[{"FileName":"去程过路费1.pdf","FileUrl":"/doc/.../..."},...]'
  Rmrk="苏州-上海往返高速通行费" ProjectID="BRS25905" RowNo="2"/>
```

#### 油费关联行程单 (ADT04)
```xml
<xmldetail FeeID="ADT04" FeeDesc="ADT,ADT04" RefDocBeginDate="2026-05-29"
  RefDocEndDate="2026-06-01" InvcNo="FAP-20260610-0062"
  FeeAmt="383.65" FeeAmtBC="383.65" Curr="CNY"
  Rmrk="上海出差油费补贴(319.71km×1.2元/km)" ProjectID="BRS25905"
  DrivingRecordNo="DRV2606000007" ActualMileage="319.71" RowNo="3"/>
```

> ⚠️ **油费关联行程单使用 ADT04（燃油费），不是 ADM03**。`InvcNo` 使用发票台账的 `DocNo`（如 FAP-20260610-0062），不是原始发票号码。`FeeAmt` 使用行程单计算的补贴金额（里程×1.2元/km），不是发票金额。油费行不需要 `FileUrl`/`Destination`/`StartPoint` 字段。

## 冲借款明细 (xmldetails2)

通常为空（无冲借款时）：
```xml
<?xml version="1.0" encoding="UTF-8" ?><ROOT></ROOT>
```

## 发票关联

费用明细中的 `InvcNo` 字段关联 OCR 识别的发票号码。多张发票用逗号分隔。

`FileUrl` 字段为 JSON 数组格式，关联上传的文件路径：
```json
[
  {"FileName": "第一天发票.pdf", "FileUrl": "/doc/2026/06/09/xxx/第一天发票.pdf"},
  {"FileName": "第二天发票.pdf", "FileUrl": "/doc/2026/06/09/xxx/第二天发票.pdf"}
]
```

## 提交示例（Python）

```python
import requests
import urllib.parse

def get_xml_from_frm(obj):
    attrs = ' '.join(f'{k}="{v}"' for k, v in obj.items() if v is not None and v != '')
    return f'<?xml version="1.0" encoding="UTF-8" ?><ROOT><xmldetail {attrs}/></ROOT>'

def get_xml_from_list(items):
    xml_items = ''
    for item in items:
        attrs = ' '.join(f'{k}="{v}"' for k, v in item.items() if v is not None and v != '')
        xml_items += f'<xmldetail {attrs}/>'
    return f'<?xml version="1.0" encoding="UTF-8" ?><ROOT>{xml_items}</ROOT>'

# 1. 登录（注意：参数名是 UserID/UserPwd，不是 UsrID/Password）
session = requests.Session()
login_resp = session.post('http://10.10.10.247/powerbip/login.do', data={
    'UserID': 'BRS1862',
    'UserPwd': 'ImdB3wWGe8CFGFVxl3QGGQ==',  # AES-CBC加密
    '_ENCODE_': 'UTF-8'
}, headers={'Content-Type': 'application/x-www-form-urlencoded'})

# 2. 构造表单数据（所有字段合并到 xmldetails0）
form = {
    'CreateUsr': 'BRS1862', 'RefEmp': 'BRS1862', 'CompanyID': 'BRS1',
    'CreateDate': '2026-06-10', 'PostDate': '2026-06-10', 'ExpenseDate': '2026-06-10',
    'APType': '0',
    'BankDocNo': '1633661740986580994',  # 从 queryprint.do 获取
    'BankInfo': '龙占全-6217732005062124-中信银行-中信银行股份有限公司苏州金鸡湖支行',
    'RefEmpOrg': 'JT117',
    'APAmt': '1094.59', 'APAmtBC': '1094.59', 'Curr': 'CNY',
    'APName': '龙占全申请的出差申请单',
    'PayoutAmt': '2000', 'PayoutAmtBC': '2000',
    'srcDocType': 'BTA', 'srcDocNo': 'CXS26050555',
    'BeginDate': '2026-05-29 15:00:02', 'EndDate': '2026-06-02 23:59:24',
    'BTDestination': '上海浦东', 'BTReason': '洋山中集项目实施',
    'BTType': '1', 'CustomerName': '中集洋山', 'ProjectID': 'BRS25905',
    'RealAPAmt': '1094.59', 'RealAPAmtBC': '1094.59'
}

# 3. 构造费用明细
expenses = [
    {
        'FeeID': 'ADT01', 'FeeDesc': 'ADT,ADT01',
        'RefDocBeginDate': '2026-05-29', 'RefDocEndDate': '2026-05-30',
        'InvcNo': 'FAP-20260610-0049',
        'FeeAmt': '190.01', 'FeeAmtBC': '190.01', 'Curr': 'CNY',
        'Destination': '中国,上海市,市辖区,浦东新区', 'AddrId': '310115',
        'Date': '2026-05-29,2026-05-30',
        'FileUrl': '[{&quot;FileName&quot;:&quot;第一天发票.png&quot;,&quot;FileUrl&quot;:&quot;/doc/2026/06/10/xxx/第一天发票.png&quot;}]',
        'Rmrk': '出差上海', 'ProjectID': 'BRS25905'
    },
]

# 4. 提交（oprperform.do 无同源验证，Python requests 可直接调用）
params = {
    'trancode': 'OA600000',
    'mode': '1',
    'DocType': 'CXB',
    'CompanyID': 'BRS1',
    'execmode': 'Audit',
    'srccopied': 'apply',
    'xmldetails0': get_xml_from_frm(form),
    'xmldetails1': get_xml_from_list(expenses),
    'xmldetails2': '<?xml version="1.0" encoding="UTF-8" ?><ROOT></ROOT>',
    '_ENCODE_': 'UTF-8'
}

# 编码：所有顶层参数不能包含中文，中文只放在XML属性中
body = urllib.parse.urlencode(params)
resp = session.post('http://10.10.10.247/powerbip/oprperform.do',
    data=body.encode('utf-8'),
    headers={'Content-Type': 'application/x-www-form-urlencoded'})
print(resp.json())  # {"Ret":"1","Code":"FORWARD","Msg":"报销单新增成功！"}
```

## 成功判断

```javascript
// 提交返回
if (!res.Code) {
  // 成功！res.Code 为空或 undefined
  console.log('提交成功，单据编号:', res.DocNo);
} else {
  // 失败
  console.error('提交失败:', res.Msg);
}
```

## 注意事项

1. **编码**：所有顶层参数不能包含中文，中文只放在XML属性中。使用 `urllib.parse.urlencode(params)` 编码后 `.encode('utf-8')` 发送，**`Content-Type` 不能带 `charset`**（设为 `application/x-www-form-urlencoded`），否则中文变成 `????????`
2. **FileUrl JSON**：XML属性中的双引号需用 `&quot;` 转义，如 `FileUrl="[{&quot;FileName&quot;:&quot;发票.png&quot;,...}]"`
3. **费用合计**：`APAmt`/`APAmtBC`/`RealAPAmt`/`RealAPAmtBC` 需等于所有费用明细金额之和
4. **Date 字段**：前端使用 `[beginDate, endDate]` 数组，提交时拆分为 `RefDocBeginDate` 和 `RefDocEndDate`，同时保留 `Date` 字段（逗号分隔）
5. **提交方式**：`oprperform.do` **无同源验证**，Python requests 可直接调用（携带登录后的 Cookie），无需浏览器
6. **srccopied**：实际验证 `apply` 值有效（非 `Submit`/`Travel`）
7. **登录**：使用 `/login.do`，参数名 `UserID`/`UserPwd`（不是 `UsrID`/`Password`），密码需 AES-CBC 加密
