# 浏览器控制台上传文件 — 实际限制与 Workaround

## 核心问题

BIP 上传接口 `/powerbip/popup/uploadFiles.do` 有同源验证，**仅能从浏览器 JavaScript 上下文成功调用**（curl/Python requests 均返回"请求非法!"）。

但在实际自动化过程中，通过 `browser_console` 工具执行上传 JS 代码会遇到以下限制：

## 限制 1：控制台输入截断

| 文件大小 | base64 后 | 控制台可行性 |
|----------|-----------|-------------|
| < 40KB | < 55KB | ✅ 单次粘贴可行 |
| 40-100KB | 55-140KB | ⚠️ 可能被截断 |
| > 100KB | > 140KB | ❌ 必然被截断 |

**原因**：`browser_console` 的 `expression` 参数有长度限制（约 50-100KB），base64 编码膨胀约 1.37 倍。

### Workaround A：分块拼接（文件 < 300KB 时可行）

将 base64 拆成 3-6 段，每段约 14-28KB，用 `window._b` 累加：

```python
import base64, json

b64 = base64.b64encode(open("file.pdf","rb").read()).decode()
part_size = len(b64) // 6 + 1
parts = [b64[i:i+part_size] for i in range(0, len(b64), part_size)]

for i, part in enumerate(parts):
    if i == 0:
        js = f'window._b="{part}"'
    elif i < 5:
        js = f'window._b+="{part}"'
    else:
        js = f'window._b+="{part}";'
        js += 'var raw=atob(window._b),nums=Array(raw.length);'
        js += 'for(var i=0;i<raw.length;i++)nums[i]=raw.charCodeAt(i);'
        js += 'var blob=new Blob([new Uint8Array(nums)]);'
        js += 'var fd=new FormData();'
        js += 'fd.append("files",blob,"file.pdf");'
        js += 'fd.append("mode","1");fd.append("type","doc");'
        js += 'var x=new XMLHttpRequest();'
        js += 'x.open("POST","/powerbip/popup/uploadFiles.do",false);'
        js += 'x.send(fd);x.responseText;'
    print(f"Part {i+1}: {len(js)} chars")
```

按 Part 1 → Part 2 → ... → Part N 顺序在浏览器控制台粘贴执行。

### Workaround B：Python 读取 → 逐文件生成独立 JS（推荐）

每个文件生成一个独立的 JS 上传脚本，在浏览器控制台逐个粘贴执行。文件按大小从小到大排序，先传小的确保流程通顺。

```python
import base64, os, json

files = sorted(os.listdir(workdir),
    key=lambda f: os.path.getsize(os.path.join(workdir, f)))

for fname in files:
    fpath = os.path.join(workdir, fname)
    with open(fpath, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    
    js = f'(function(){{var b=atob({json.dumps(b64)}),n=Array(b.length);'
    js += 'for(var i=0;i<b.length;i++)n[i]=b.charCodeAt(i);'
    js += 'var blob=new Blob([new Uint8Array(n)]);'
    js += 'var fd=new FormData();'
    js += f'fd.append("files",blob,{json.dumps(fname)});'
    js += 'fd.append("mode","1");fd.append("type","doc");'
    js += 'var x=new XMLHttpRequest();'
    js += 'x.open("POST","/powerbip/popup/uploadFiles.do",false);'
    js += 'x.send(fd);x.responseText;'
    js += '}})()'
    
    print(f"// {fname} — {len(js)} chars")
    if len(js) > 50000:
        print("// ⚠️ 可能超出控制台输入限制，需用 Workaround A 分块")
```

### Workaround C：跳过上传，直接提交报销单（最简方案）

如果上传文件不是必须的（或可后续手动补传），可以**直接通过 API 提交报销单**，不包含附件：

```javascript
// 直接调用 oprperform.do 提交报销单
// 费用明细中不包含 FileUrl 字段即可
```

## 限制 2：iframe 沙盒限制

当 BIP 页面在 `browser_navigate` 工具的 iframe 中渲染时：

| 操作 | 是否可行 | 原因 |
|------|----------|------|
| `XMLHttpRequest` 相对路径 | ✅ 可行 | 同源请求不受沙盒影响 |
| `document.cookie` | ❌ 不可行 | iframe 沙盒禁止读取 cookie |
| `fetch` 到 localhost | ❌ 不可行 | 混合内容 + CORS + 沙盒三重限制 |
| `<script>` 标签注入 | ❌ 不可行 | 沙盒禁止跨源脚本加载 |
| `FormData` + `XMLHttpRequest` | ✅ 可行 | 同源上传正常工作 |

**结论**：在 iframe 中只能通过直接粘贴 JS 代码到控制台来上传文件。无法通过外部 HTTP 服务或 script 标签注入加载 JS。

## 推荐方案：本地 HTTP 服务器 + 同步 XHR（最优）

**完全替代 base64 分块方案**。详见 `references/local-http-server-bypass.md`。

### 优势
- ❌ 无需手动粘贴 base64 代码
- ❌ 无文件大小限制
- ✅ 在浏览器控制台执行一行循环即可批量上传所有文件
- ✅ 同步 XHR 可绕过 iframe 沙盒对异步请求的限制

### 快速操作

```bash
# 终端：启动本地 HTTP 服务器
cd "D:\path\to\invoices"
python -c "
import http.server, os
os.chdir(r'D:\path\to\invoices')
class C(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','GET,OPTIONS')
        self.send_header('Access-Control-Allow-Headers','*')
        super().end_headers()
    def do_OPTIONS(self):
        self.send_response(200);self.end_headers()
httpd=http.server.HTTPServer(('0.0.0.0',8899),C)
print('Serving on 8899');httpd.serve_forever()
"
```

```javascript
// 浏览器控制台：批量上传所有文件
var files = ['file1.pdf', 'file2.pdf', 'file3.jpg'];
for (var i = 0; i < files.length; i++) {
  var g = new XMLHttpRequest();
  g.open('GET', 'http://localhost:8899/' + encodeURIComponent(files[i]), false);
  g.responseType = 'blob'; g.send();
  var fd = new FormData();
  fd.append('files', g.response, files[i]);
  fd.append('mode', '1'); fd.append('type', 'doc');
  var u = new XMLHttpRequest();
  u.open('POST', '/powerbip/popup/uploadFiles.do', false);
  u.send(fd);
  console.log((i+1)+'/'+files.length+' '+files[i]+' → '+(JSON.parse(u.responseText).Data?.[0]?.Path||'FAIL'));
}
```

## 备选方案（base64 分块 — 仅当本地服务器不可用时）

当无法启动本地 HTTP 服务器时，仍可使用 base64 分块方案。

### 推荐工作流

```
① Python 读取文件 → base64 编码
   ↓
② 检查 JS 长度是否 < 50KB
   ├─ 是 → 生成单段 JS，在浏览器控制台执行
   └─ 否 → 拆分为 3-6 段，逐段粘贴执行
   ↓
③ 确认上传成功（返回 Data[0].Path）
   ↓
④ 用上传返回的 Path 构建费用明细的 FileUrl
   ↓
⑤ 通过 API (oprperform.do) 提交报销单
```

## 完全自动化方案（备选）

如果上传文件是必经步骤，最可靠的方式是：

1. **先通过 API 提交报销单（不含附件）** — 使用 `oprperform.do` 直接提交
2. **上传文件** — 通过浏览器控制台逐个上传
3. **补传附件** — 通过 `oprperform.do` (mode=2, 编辑模式) 更新费用明细的 FileUrl

这样即使上传步骤遇到问题，报销单已经提交成功，附件可后续补传。
