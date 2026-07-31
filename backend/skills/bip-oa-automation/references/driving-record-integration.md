# 行车记录查询与报销关联

## 概述

出差自驾场景下，BIP 的行车记录（DocType: DRV）记录了每次出车的里程、时间、出发地/目的地等信息。差旅报销时可关联行车记录，系统自动计算油费补贴。

## 补贴计算规则

```
补贴金额 = 里程(Mileage) × 1.2 元/km
```

源码位置: `OA600000F/component/reApplicationDialog.vue` 第 167 行:
```javascript
item.SubAmt = (Number(item.Mileage) * 1.2).toFixed(2);
```

## 查询行车记录 API

### 参数
```
POST /powerbip/querylistd.do
Content-Type: application/x-www-form-urlencoded

参数:
  trancode:   'OA300910'
  DocType:    'DRV'
  mode:       4
  execmode:   'Query'
  srccopied:  'Info'
  CompanyID:  'BRS1'
  Order_By_Customized_Field: 'a.CreateDate desc'
  xmldetails: '<?xml version="1.0" encoding="UTF-8"?><ROOT><xmldetail EmpID="BRS1862" DocNos="" IsShow="0"/></ROOT>'
```

### 返回字段
| 字段 | 说明 | 示例 |
|------|------|------|
| DocNo | 行车记录编号 | DRV2606000007 |
| DocStatus | 状态 (0=有效) | 0 |
| EmpID | 驾驶员 | BRS1862 |
| TravelMode | 出行方式 | 自驾 |
| AddrFrom | 出发地 | 苏州吴中区 |
| AddrTo | 目的地 | 苏州吴中区 |
| BeginDate | 出发时间 | 2026-05-29 18:44:05 |
| EndDate | 到达时间 | 2026-06-01 14:42:36 |
| Mileage | 里程(km) | 319.71 |
| SubAmt | 补贴金额(自动计算) | 383.65 |
| CreateDate | 创建时间 | 2026-06-01 14:42 |
| CreateUsr | 创建人 | BRS1862 |

### 查询编码陷阱
- 响应编码为 **GBK**，需用 `overrideMimeType('text/plain; charset=gbk')` 或 `TextDecoder('gbk')` 解码
- 空 `DocNos` 参数查询所有记录，传入逗号分隔的 DocNo 可筛选特定记录
- 参数 `xmldetails` 必须为 XML 格式，其中 `EmpID` 为必填
- **⚠️ 浏览器控制台查询陷阱**: 在浏览器控制台中使用 `XMLHttpRequest` 查询时，如果传入了 `xmldetails` XML 参数，XML 字符串中的双引号必须正确转义。建议用单引号包裹整个 JS 字符串，XML 内部属性用双引号：
  ```javascript
  x.send('trancode=OA300910&...&xmldetails=<?xml version="1.0" encoding="UTF-8"?><ROOT><xmldetail EmpID="BRS1862" DocNos="" IsShow="0"/></ROOT>');
  ```
  如果 JS 字符串用双引号包裹，XML 内部的引号必须用 `\"` 转义。

## 行车记录详情查询

查看单条行车记录的行程点（途经点）：
```
POST /powerbip/querylistd.do
参数:
  trancode:   'OA300910'
  mode:       4
  execmode:   'Query'
  srccopied:  'Details'
  DocNo:      'DRV2606000007'
  DocType:    'DRV'
  CompanyID:  'BRS1'
```

## 在费用报销中关联行车记录

### 费用明细中的关联字段
在差旅报销单（CXB）的费用明细中：
- 费用类型 `FeeID` 必须为 `ADT04`（燃油费/油费补贴）才能关联行车记录
- 字段 `DrivingRecordNo` 存储关联的行车记录编号（逗号分隔）
- 字段 `ActualMileage` 存储实际里程（自动汇总）
- 字段 `SubAmt` 存储补贴金额（自动计算）

### 关联 UI 流程
1. 在费用明细行中双击 `DrivingRecordNo` 列
2. 弹出 `reApplicationDialog` 组件，查询行车记录列表
3. 勾选需要关联的记录
4. 系统自动汇总里程和补贴金额

### 费用明细行示例（ADT04 油费补贴）
```javascript
{
  FeeID: 'ADT04',
  FeeDesc: 'ADT,ADT04',
  FeeAmt: '383.65',
  FeeAmtBC: '383.65',
  Curr: 'CNY',
  Rmrk: '上海出差油费补贴(319.71km×1.2元/km)',
  DrivingRecordNo: 'DRV2606000007',
  ActualMileage: '319.71',
  RefDocBeginDate: '2026-05-29',
  RefDocEndDate: '2026-06-01',
  Date: ['2026-05-29', '2026-06-01'],
  ProjectID: 'BRS25905',
}
```

## 注意事项
1. 行车记录需在出差前/中在 BIP 中创建（可通过手机端或 Web 端提交）
2. 油费补贴 ADT04 和住宿费 ADT01、过路费 ADT0304 是独立的费用明细行
3. 关联行车记录后，系统自动锁定里程和补贴金额，手动修改无效
4. 查询时 `IsShow=0` 表示非查看模式（选择模式），`IsShow=1` 表示查看模式
