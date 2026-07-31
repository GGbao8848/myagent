# 多票据差旅报销完整工作流（2026-06-10 实战记录）

## 场景

出差上海（洋山中集项目实施），12张票据需要一次报销：
- 3张住宿专用发票（上海迪尚酒店，5/30-6/1）
- 3张酒店水单（住宿凭证）
- 5张高速过路费（苏州↔上海往返）
- 1张油费发票（95号汽油）

## 完整执行步骤

### 0. 前置：查询数据

```python
# 登录（注意：参数名是 UserID/UserPwd，不是 UsrID/Password）
session.post('http://10.10.10.247/powerbip/login.do', data={
    'UserID': 'BRS1862',
    'UserPwd': encrypted_password,
    '_ENCODE_': 'UTF-8'
})

# 查询费用类型
session.post('http://10.10.10.247/powerbip/querylistd.do', data={
    'trancode': 'BC910300', 'mode': '4', 'CompanyID': 'BRS1',
    'execmode': 'Query', 'srccopied': 'All', 'DocType': 'CXB',
    'ExecDocType': 'CXB', '_ENCODE_': 'UTF-8'
})

# 查询银行卡
session.post('http://10.10.10.247/powerbip/queryprint.do', data={
    'trancode': 'OA600000', 'mode': '4', 'CompanyID': 'BRS1',
    'DocType': 'CXB', 'execmode': 'Query', 'srccopied': 'EmpInfo',
    'xmldetails': '<?xml version="1.0" encoding="UTF-8" ?><ROOT><xmldetail RefEmp="BRS1862" LoanType="1"/></ROOT>',
    '_ENCODE_': 'UTF-8'
})

# 查询出差申请单
session.post('http://10.10.10.247/powerbip/querylistd.do', data={
    'CompanyID': 'BRS1', 'trancode': 'OA600000', 'mode': '4',
    'execmode': 'Query', 'srccopied': 'Info', 'DocType': 'CXB',
    'Order_By_Customized_Field': 'a.CreateDate desc',
    'xmldetails': '<?xml version="1.0" encoding="UTF-8" ?><ROOT><xmldetail EmpID="BRS1862" IsShow="0"/></ROOT>',
    '_ENCODE_': 'UTF-8'
})
```

### 1. 上传文件

Python requests 直接上传（已验证可行，无需浏览器）：

```python
for fname in files:
    with open(path, 'rb') as f:
        r = session.post('http://10.10.10.247/powerbip/popup/uploadFiles.do',
            files={'files': (fname, f.read(), mime)},
            data={'mode': '1', 'type': 'doc'})
    result = r.json()  # {"Ret":"1","Data":[{"Path":"/doc/2026/06/10/xxx/文件名.pdf"}]}
```

### 2. OCR 识别

```python
for fpath in uploaded_paths:
    params = {
        'billAddrs': json.dumps([{'fileAddr': fpath, 'templateSign': '', 'invcType': ''}]),
        'handle': 'bip',
        'apiurl': '/receipt/multipleInvoice',
        'zsorcs': 'zs',
        '_ENCODE_': 'UTF-8'
    }
    r = session.post('http://bip.br-robot.com/ediadapter/zs/query',
        data=urllib.parse.urlencode(params).encode('utf-8'),
        headers={'Content-Type': 'application/x-www-form-urlencoded'})
    data = r.json()
    inv = data['body'][0]
    print(inv['InvcAmt'], inv['SellerName'], inv['InvcType'])
```

### 3. 提交报销单

**关键：中文只放在XML属性中，顶层参数不能含中文，使用默认UTF-8编码**

```python
import urllib.parse

params = {
    'trancode': 'OA600000',
    'CompanyID': 'BRS1',
    'mode': '1',
    'DocType': 'CXB',
    'execmode': 'Audit',
    'srccopied': 'apply',
    'xmldetails0': xml0,   # XML中可包含中文
    'xmldetails1': xml1,   # XML中可包含中文
    'xmldetails2': xml2,
    '_ENCODE_': 'UTF-8'
}

# ✅ 使用 urllib.parse.urlencode(params) 默认UTF-8编码
# ⚠️ 不要用 encoding='GBK' — 工时填报skill已验证：GBK编码会导致中文乱码
body = urllib.parse.urlencode(params)
r = session.post('http://10.10.10.247/powerbip/oprperform.do', 
                 data=body.encode('utf-8'),
                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
print(r.text)  # {"Ret":"1","Code":"FORWARD","Msg":"报销单新增成功！"}
```

```python
def make_file_url_json(files_list):
    """files_list: list of (FileName, FileUrl) tuples"""
    items = [f'{{"FileName":"{fn}","FileUrl":"{fu}"}}' for fn, fu in files_list]
    json_str = '[' + ','.join(items) + ']'
    return json_str.replace('"', '&quot;')  # XML属性转义
```

**xmldetails0 — 主表单字段（必须包含出差申请关联）：**

| 字段 | 来源 | 说明 |
|------|------|------|
| CreateUsr/RefEmp | 登录用户ID | BRS1862 |
| CreateDate/PostDate/ExpenseDate | 当天日期 | 2026-06-10 |
| CompanyID | 登录态 | BRS1 |
| APType | 固定 | 0 |
| BankDocNo | 步骤② | 银行卡账户ID |
| BankInfo | 步骤② | "姓名-卡号-银行-开户行" |
| RefEmpOrg | 步骤② | 部门ID |
| APAmt/APAmtBC | 费用合计 | 所有明细金额之和 |
| PayoutAmt/PayoutAmtBC | 步骤③ | 出差申请预算金额 |
| srcDocType/srcDocNo | 步骤③ | BTA / 申请单号 |
| BeginDate/EndDate | 步骤③ | 出差起止时间 |
| BTDestination/BTReason | 步骤③ | 目的地/事由 |
| CustomerName/ProjectID | 步骤③ | 客户/项目 |
| RealAPAmt/RealAPAmtBC | 费用合计 | 同APAmt |

**xmldetails1 — 费用明细行（每行一个 `<xmldetail>`）：**

| 字段 | 说明 |
|------|------|
| ProjectID | 项目ID |
| FeeDesc | 费用类型路径（如 ADT,ADT01 / ADT,ADT03,ADT0304 / ADT,ADT04） |
| FeeID | 费用ID（如 ADT01=住宿, ADT0304=过路过桥, ADT04=燃油） |
| FeeAmt/FeeAmtBC | 含税金额 |
| Date | 日期范围（逗号分隔） |
| RefDocBeginDate/RefDocEndDate | 引用日期 |
| Destination/AddrId | 目的地/地区编码（住宿费） |
| StartPoint/Destination | 出发地/目的地（交通费） |
| FileUrl | 附件JSON（`&quot;`转义） |
| Rmrk | 备注说明 |

**成功返回：**
```json
{"Ret":"1","Code":"FORWARD","Msg":"报销单新增成功！","MsgEn":"报销单新增success！","Data":[]}
```

## 费用分类规则（本次实战验证）

| 发票内容 | FeeID | FeeDesc | 说明 |
|---------|-------|---------|------|
| 住宿费（酒店专用发票） | ADT01 | ADT,ADT01 | 需附水单 |
| 高速通行费（城际） | ADT0304 | ADT,ADT03,ADT0304 | 过路过桥费 |
| 燃油费（汽油发票） | ADT04 | ADT,ADT04 | 燃油费 |

注意：城际高速通行费（苏州↔上海）归 ADT0304（过路过桥费），不是 ADT0305（其他交通）。这是本次实战中根据费用类型查询结果确认的。

## 关键教训（本次实战验证）

### 1. 住宿费每张发票需单独一行

**问题**：最初尝试将3晚住宿合并为一行（总金额603.74），提交失败。
**原因**：每行费用明细的 `InvcNo` 只能绑定一张发票台账（FAP DocNo），且费用金额不能大于发票金额。
**解决**：住宿费拆分为3行，每行对应一张发票/一晚住宿：

| 行 | 日期 | 金额 | 发票台账 | 说明 |
|---|------|:----:|:--------:|------|
| 1 | 5/29-5/30 | ¥190.01 | FAP-20260610-0049 | 第一天住宿（有FAP） |
| 2 | 5/30-5/31 | ¥232.03 | — | 第二天住宿（无FAP，不填InvcNo） |
| 3 | 5/31-6/1 | ¥181.70 | — | 第三天住宿（无FAP，不填InvcNo） |

### 2. 无FAP台账的行不填InvcNo

对于没有查询到发票台账（FAP DocNo）的费用行，`InvcNo` 字段留空即可，系统不会报错。

### 3. FileUrl 使用 &quot; 转义

在 XML 属性中，JSON 字符串的双引号必须用 `&quot;` 转义：
```python
def make_file_url_xml_attr(file_urls):
    items = [f'{{"FileName":"{fn}","FileUrl":"{fu}"}}' for fn, fu in file_urls]
    json_str = '[' + ','.join(items) + ']'
    return json_str.replace('"', '&quot;')
```

### 4. 编码：Content-Type 不能带 charset

**问题**：最初使用 `Content-Type: application/x-www-form-urlencoded; charset=UTF-8` 提交，中文变成 `????????`。

**根因**：前端 `request.js` 第13行是 `headers: { 'Content-Type': 'application/x-www-form-urlencoded' }` — **没有 charset**。BIP 服务器在 Content-Type 带 charset 时错误解析中文。

**解决**：
```python
headers = {'Content-Type': 'application/x-www-form-urlencoded'}  # 不能带 charset！
body = urllib.parse.urlencode(params).encode('utf-8')
```

### 5. 油费使用 ADT04 非 ADM03

**问题**：最初使用 ADM03（油费补贴）作为油费 FeeID。
**原因**：实际系统费用类型查询结果显示，ADT04（燃油费）才是正确的叶子节点，ADM03 不在此费用类型树中。
**解决**：使用 `FeeID=ADT04`, `FeeDesc=ADT,ADT04`

### 8. FAP台账 InvcName 字段

**问题**：提交报销单时报错 `"发票的开票抬头与所属公司抬头不一致，请重新上传发票！"`

**根因**：FAP台账中购买方名称的字段名是 **`InvcName`**（不是 `PurchaserName`）。通过API创建的FAP记录如果缺少 `InvcName`，提交报销单时系统会校验发票抬头与公司抬头是否一致。

**字段映射**：

| OCR返回字段 | FAP台账字段 | 说明 |
|------------|------------|------|
| PurchaserName | **InvcName** | 购买方名称（如"江苏北人智能制造科技股份有限公司"） |
| SellerName | VendorName | 销售方名称 |
| vatCode | InvcType | 发票类型代码（如 elec_invoice_special） |

**⚠️ 创建FAP时必须包含 InvcName**：
- 通过 `oprperform.do` (mode=1) 创建FAP时，在 `xmldetails0` 中设置 `InvcName` 属性
- 通过 `oprperform.do` (mode=2) 更新时，`InvcName` 字段**不会更新**（即使返回"修改成功"），必须删除后重新创建
- 删除FAP记录（mode=3）是**软删除**，删除后发票号仍被占用，无法用相同发票号重新创建
- 因此**首次创建FAP时必须包含正确的 InvcName**，后续无法修改

**创建FAP记录的完整示例**：
```python
params = {
    'trancode': 'OA600100',
    'CompanyID': 'BRS1',
    'mode': '1',
    'DocType': 'FAP',
    'execmode': 'Audit',
    'srccopied': 'apply',
    '_ENCODE_': 'UTF-8',
    'xmldetails0': '''<?xml version="1.0" encoding="UTF-8" ?>
<ROOT><xmldetail CompanyID="BRS1" DocType="FAP"
  InvcType="elec_invoice_special"
  InvcNo="26312000003359109541"
  InvcDate="2026-05-30"
  InvcAmt="190.01" InvcAmtBC="190.01"
  NetAPAmt="179.25" NetInvcAmt="179.25"
  TaxAmt="10.76" DeductionTaxAmt="10.76"
  InvcName="江苏北人智能制造科技股份有限公司"
  InvcTaxNo="91320000588426511G"
  VendorName="上海迪尚酒店管理有限公司"
  VendorTaxNo="91310115MA1HADDG8C"
  FileUrl="/doc/2026/06/10/xxx/第一天发票.pdf"
  InvcCurr="CNY" CheckStatus="1"/></ROOT>'''
}
```

**FAP台账查询字段列表**（querylistd.do 返回）：
```
CompanyID, CreateDate, CreateUsr, DocNo, DocType, FileUrl, InvcAmt, InvcAmtBC, InvcDate, InvcNo, InvcType, LineNum, LineSeq, NetAPAmt, SrcUserID, VendorName
```
前端创建的FAP记录额外包含：`CheckStatus, DeductionTaxAmt, Details, Enable, InvcCheckMessage, InvcCurr, InvcName, InvcTaxNo, NetInvcAmt, TaxAmt, VendorTaxNo`

### 9. 费用明细的 InvcNo 关联FAP台账DocNo

费用明细行中的 `InvcNo` 字段**不是**原始发票号码，而是 **FAP发票台账的 DocNo**（如 `FAP-20260610-0049`）。

```xml
<!-- 正确：InvcNo 引用 FAP 台账的 DocNo -->
<xmldetail ... InvcNo="FAP-20260610-0049" .../>

<!-- 错误：InvcNo 填原始发票号码 -->
<xmldetail ... InvcNo="26312000003359109541" .../>
```

每行费用明细都必须关联对应的 FAP 台账记录（InvcNo 字段），不能只关联第一行。

**问题**：之前认为 `oprperform.do` 有同源验证（类似 uploadFiles.do）。
**实际**：`oprperform.do` 可直接从 Python requests 调用（携带登录 Cookie），无需浏览器上下文。

### 7. 提交参数 srccopied=apply

**问题**：之前使用 `srccopied=Submit` 或 `srccopied=Travel`。
**实际**：差旅报销提交使用 `srccopied=apply` 有效。这是前端 BasicInfo.js 中 submitType 的实际值。

当油费报销涉及行程单时（如开车出差），需要：

### 1. 查询发票台账获取 FAP DocNo

```python
params = {
    'trancode': 'OA600100', 'mode': '4', 'CompanyID': 'BRS1',
    'DocType': 'FAP', 'execmode': 'Query', 'srccopied': 'ALL',
    'Order_By_Customized_Field': 'a.CreateDate desc',
    'xmldetails0': '<?xml version="1.0" encoding="UTF-8" ?><ROOT><xmldetail SrcUserID="BRS1862" IsShow="0"/></ROOT>',
    '_ENCODE_': 'UTF-8'
}
r = session.post('http://10.10.10.247/powerbip/querylistd.do',
    data=urllib.parse.urlencode(params).encode('utf-8'),
    headers={'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'})
data = r.json()
# 找到油费发票的 DocNo，如 FAP-20260610-0062
```

### 2. 提交时使用补贴金额

```python
# 油费行（关联行程单）
row = {
    'ProjectID': 'BRS25905',
    'FeeDesc': 'ADT,ADT04',
    'Curr': 'CNY',
    'InvcNo': 'FAP-20260610-0062',     # 发票台账DocNo
    'FeeAmt': '383.65',                  # 补贴金额 = 319.71km × 1.2元/km
    'FeeAmtBC': '383.65',
    'FeeID': 'ADT04',                    # 燃油费
    'DrivingRecordNo': 'DRV2606000007',  # 行程单编号
    'ActualMileage': '319.71',           # 实际里程
    'Rmrk': '出差上海',
    'Date': '2026-05-29,2026-06-01',
    'RefDocBeginDate': '2026-05-29',
    'RefDocEndDate': '2026-06-01'
}
```

### 3. 关键区别

| 项目 | 无行程单（普通油费） | 有行程单（关联行程） |
|------|---------------------|---------------------|
| FeeID | ADT04 | ADT04 |
| FeeAmt | 发票金额（如542.41） | 补贴金额（里程×1.2） |
| InvcNo | 可选 | 必须使用FAP DocNo |
| DrivingRecordNo | 无 | 必须 |
| ActualMileage | 无 | 必须 |
| FileUrl | 可附发票 | 通常不需要 |
