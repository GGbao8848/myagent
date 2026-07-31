# BIP API 参考

> ⚠️ 本文档为速查参考，以 `scripts/` 中的代码实现为准。如有偏差，以代码为准。

## 端点

| 接口 | URL | 用途 |
|------|-----|------|
| 登录 | `POST /powerbip/login.do` | 获取 Cookie（JSESSIONID, userid, companyid） |
| 查询 | `POST /powerbip/querylistd.do` | 查项目/阶段/考勤/常用任务/已提交报工单 |
| 操作 | `POST /powerbip/oprperform.do` | 提交/删除/撤销/修改状态 |
| 审批 | `POST /powerbip/transfer` | 提交工作流 |

## 查询 SrcCopied

| 值 | 用途 |
|----|------|
| `ProjectList` | 查项目列表 |
| `TaskList` | 查阶段/任务列表（全量保底） |
| `GETCANREPORTTASKSLISTS` | 查用户常用任务（主渠道，部门工作优先） |
| `GETATTNTIMEBYRPTDATE` | 查考勤 |

## 操作 trancode

| 值 | 用途 |
|----|------|
| `PM300300` mode=1 | 提交报工（xmldetails1 可含多条 `<xmldetail>` 按 DetailSeq 区分） |
| `PM300300` mode=3 | 删除报工单 |
| `PM300300` mode=5 | 查询已提交报工单（含审批状态） |
| `PM300300` mode=8, execmode=UnAudit | 反审核（撤销步骤一） |
| `PM300302` mode=2, execmode="" | 修改状态为审批中 |
| `PM300302` mode=2, execmode=UnAudit | 更新明细审批状态（撤销步骤二） |

## 登录加密

AES-128-CBC, key=`Test-AES-CBC-128`, IV=`1234567890123456`, PKCS7 padding, Base64 输出。

## 提交注意事项

- 用 `urllib.parse.urlencode`，不用 `data=dict`
- `ReportDesc` 顶层参数必须为 `""`
- 中文报工内容写在 xmldetails1 的 `ReportDesc` 属性中
- 非项目类（部门工作）：xmldetails1 不含 ProjectID/ProjectName/ProjectManager/ProjectType
- 项目类（项目工时/销售支持）：xmldetails1 含完整项目与阶段字段
- **多明细拆分**：xmldetails1 可含多条 `<xmldetail>`，按 `DetailSeq="1"`, `DetailSeq="2"` 区分；xmldetails0 汇总全部工时
