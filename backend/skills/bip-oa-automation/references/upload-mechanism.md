# BIP 文件上传机制详解

## 上传端点

```
POST /powerbip/popup/uploadFiles.do
Content-Type: multipart/form-data
```

### 固定参数
| 参数 | 值 | 说明 |
|------|-----|------|
| mode | 1 | 上传模式 |
| type | doc | 文件类型（doc=文档） |

### 文件参数
| 参数 | 说明 |
|------|------|
| files | 文件二进制数据，支持多文件 |

## 同源验证（关键陷阱）

上传接口 `/powerbip/popup/uploadFiles.do` 有**服务端同源验证**，仅接受来自 BIP 页面的请求：

> **重要**：实际通过 `browser_console` 工具上传时，base64 编码的文件数据超过约 **50KB** 就会被截断（而非浏览器控制台本身的限制）。需要将文件拆分为 3-6 段分步粘贴执行。详见 `references/browser-console-upload-workarounds.md`。

### ⚠️ 实际行为不一致

**本次会话验证（2026-06-10）：** 通过 Python `requests.Session` 直接调用 `uploadFiles.do`（携带登录后的 Cookie），成功上传了12个文件（PDF/JPG），**没有遇到同源验证问题**。这意味着同源验证可能依赖于特定环境配置（如反向代理、IP白名单、或服务器版本）。

**策略：**
1. **优先尝试 Python requests 直接上传** — 如果成功，这是最简单的方式
2. **失败时回退到浏览器 JS 上传** — 通过 `XMLHttpRequest` + `FormData` 在 BIP 页面上下文中上传

```python
# ✅ Python requests — 可能成功（已验证）
session = requests.Session()
# 先登录
session.post('http://10.10.10.247/powerbip/login.do', data={...})
# 再上传
with open('file.pdf', 'rb') as f:
    r = session.post('http://10.10.10.247/powerbip/popup/uploadFiles.do',
        files={'files': ('file.pdf', f.read(), 'application/pdf')},
        data={'mode': '1', 'type': 'doc'})
print(r.json())  # {"Ret":"1","Data":[{"Path":"/doc/..."}]}
```

### 失败方式
```bash
# ❌ curl — 即使携带完整 Cookie 也失败
curl -X POST "http://10.10.10.247/powerbip/popup/uploadFiles.do" \
  -H "Cookie: userid=BRS1862; Token=xxx; companyid=BRS1" \
  -F "files=@file.pdf" -F "mode=1" -F "type=doc"
# 返回: {"Ret":"2","Msg":"请求非法!"}
```

```python
# ❌ Python requests — 同样失败
import requests
r = requests.post("http://10.10.10.247/powerbip/popup/uploadFiles.do",
    cookies={"userid":"BRS1862", ...},
    files={"files": ("test.pdf", data, "application/pdf")},
    data={"mode":"1","type":"doc"})
# 返回: {"Ret":"2","Msg":"请求非法!"}
```

### 成功方式
```javascript
// ✅ 浏览器中 — 使用相对路径 + XMLHttpRequest（同步模式）
(function(){
  var x = new XMLHttpRequest();
  x.open('POST', '/powerbip/popup/uploadFiles.do', false);  // 同步
  var fd = new FormData();
  fd.append('mode', '1');
  fd.append('type', 'doc');
  fd.append('files', blob, 'file.pdf');
  x.send(fd);
  return x.responseText;
})()
```

```javascript
// ✅ 浏览器中 — 使用 fetch（异步）
fetch('/powerbip/popup/uploadFiles.do', {
  method: 'POST',
  body: (()=>{ var fd=new FormData(); fd.append('mode','1'); fd.append('type','doc'); fd.append('files',blob,'file.pdf'); return fd; })()
}).then(r=>r.text()).then(console.log)
```

### 关键要求
1. **浏览器必须在 BIP 页面**（同源 `http://10.10.10.247`），不能是 `about:blank`
2. **必须使用相对路径** `/powerbip/popup/uploadFiles.do` — 绝对路径 `http://10.10.10.247/...` 触发 CORS 错误
3. **浏览器必须已登录**（有有效的 JSESSIONID Cookie）
4. **`XMLHttpRequest` 同步模式** (`false` 参数) 可让结果直接返回，适合控制台单步执行
5. **`fetch` 异步模式** 需要 `.then()` 处理结果，结果可能因跨域限制为 `null`，但上传本身成功

## 大文件上传策略

当文件较大（>100KB）时，base64 编码后的 JS 代码可能超出浏览器控制台的输入限制（约 500KB-1MB）。

### 推荐策略：逐文件上传

1. **Python 端**：读取文件 → base64 编码 → 生成单文件上传 JS 片段
2. **浏览器端**：在控制台逐个执行 JS 片段（每次只传一个文件）

```python
import base64, os

base = r"D:\path\to\invoices"
files = ["file1.pdf", "file2.pdf", ...]

for f in files:
    path = os.path.join(base, f)
    with open(path, 'rb') as fh:
        data = fh.read()
    b64 = base64.b64encode(data).decode()
    ext = os.path.splitext(f)[1].lower()
    mime = {'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg'}.get(ext,'application/octet-stream')
    
    js = f"""
(function(){{
  var __data = atob('{b64}');
  var __bytes = new Uint8Array(__data.length);
  for(var i=0;i<__data.length;i++)__bytes[i]=__data.charCodeAt(i);
  var __blob = new Blob([__bytes],{{type:'{mime}'}});
  var __fd = new FormData();
  __fd.append('files',__blob,'{f}');
  __fd.append('mode','1');
  __fd.append('type','doc');
  var __x = new XMLHttpRequest();
  __x.open('POST','/powerbip/popup/uploadFiles.do',false);
  __x.send(__fd);
  console.log(__x.responseText);
}})()
"""
    print(f"// {f} ({len(data)} bytes) — JS: {len(js)} chars")
    print(js)
```

### 文件大小参考
| 文件类型 | 典型大小 | base64 膨胀后 | 控制台可行性 |
|----------|----------|---------------|-------------|
| 电子发票 PDF | 80-150KB | 110-200KB | ⚠️ 可能超限（需分块） |
| 扫描件 PDF | 200-300KB | 270-400KB | ❌ 需分块 |
| 酒店水单 PNG | 150-200KB | 200-270KB | ❌ 需分块 |
| 手机照片 JPG | 400-500KB | 530-670KB | ❌ 需分块 |

> **实际限制**：通过 `browser_console` 工具的 `expression` 参数执行 JS 时，base64 编码超过约 **50KB** 就会被截断。62KB 的 PDF 文件（base64 ~85KB）需要拆分为 3 段每段 ~28KB 才能执行。详见 `references/browser-console-upload-workarounds.md`。

## 上传返回格式

### 成功
```json
{"Ret":"1","Code":"","Msg":"上传成功","Data":[{"Path":"/doc/2026/06/09/1780992918555/test.pdf"}]}
```

### 失败
```json
{"Ret":"2","Code":"","Msg":"请求非法!","Data":[]}
```

## 文件上传后的处理流程

### 场景 A：通用文件台账（CM100100S）
1. 上传 → 获取 Path
2. 填入表格（FileType + FileUrl）
3. 调用 `oprperform.do` (trancode=CM100100, mode=1) 保存文件台账

### 场景 B：发票上传+OCR（uploadDialog.vue）
1. 上传 → 获取 Path
2. 选择发票类型（invoiceType）
3. 调用 OCR `/receipt/multipleInvoice` 识别发票信息
4. 调用 `oprperform.do` (trancode=OA600100, mode=1, DocType=FAP) 保存发票台账

### 场景 C：费用报销附件（OA600000FD）
1. 上传 → 获取 Path
2. 将 Path 填入费用明细行的 `FileUrl` 字段（JSON 数组格式）
3. 提交报销单时一并保存

## 常见错误

| 错误 | 原因 | 解决 |
|------|------|------|
| `请求非法!` | 非浏览器上下文/同源验证失败 | 在浏览器控制台中用相对路径上传 |
| CORS / NetworkError | 使用了绝对路径 | 改用相对路径 `/powerbip/...` |
| `about:blank` 页面 | 浏览器导航到了空白页 | 先导航回 BIP 页面 |
| fetch 返回 null | 跨域限制 | 改用 XMLHttpRequest 同步模式 |
