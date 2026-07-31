# 差旅报销单 (CXB) 表单结构

## 组件树

```
OA600000F.vue (费用报销申请列表)
  └─ OA600000FC.vue (差旅报销单 — 抽屉弹窗)
       ├─ FormEditCopy #1 — 基本信息 (form1)
       ├─ FormEditCopy #2 — 业务相关信息 (form2)
       ├─ el-table — 费用明细列表 (tableData)
       └─ 费用明细编辑弹窗 (动态组件)
```

## 源码路径

```
D:\powercom\powerapps\BIP\src\components\page\oa\OA600000F\
├── OA600000F.vue       — 列表页 (含 dropdownOption 定义)
├── OA600000FA.vue      — 一般报销单
├── OA600000FB.vue      — 业务招待费报销单
├── OA600000FC.vue      — 差旅报销单 (CXB)
├── OA600000FD.vue      — 分摊报销单
├── OA600000FE.vue      — 项目临时采购报销单
├── OA600000FF.vue      — 无票报销单
├── OA600000FG.vue      — 费用明细编辑弹窗 (差旅)
├── OA600000FH.vue      — 费用明细编辑弹窗 (一般)
├── component/
│   ├── uploadDialog.vue    — 发票上传+OCR
│   └── reApplicationDialog.vue — 出差申请关联弹窗
```

## OA600000FC.vue — 差旅报销单表单

### 基本信息 (form1)

通过 `baseForm` 定义字段，通过 `FormEditCopy` 组件渲染（3列布局）。

### 业务相关信息 (form2)

通过 `baseForm2` 定义，包含出差申请关联（`reTravelApplication` 事件）。

### 费用明细 (tableData)

| 列 | 字段 | 说明 |
|----|------|------|
| 费用类别 | FeeDesc | 取数组最后一项显示 |
| 消费日期 | Date | 显示 "开始 至 结束" |
| 发票 | InvcNo | 点击可查看发票 |
| 含税金额 | FeeAmt | 含币种符号 |
| 本币金额 | FeeAmtBC | 本币符号+金额 |
| 成本归属 | ProjectID | 显示为 OrgName |
| 费用事由 | Rmrk | 文本 |

### 费用明细编辑 (showFeeDtl)

调用 `showFeeDtl(index, row, type)`：
- type=1: 查看模式
- type=2: 编辑模式

动态加载组件到 `dialogRef`，根据 `DocType` 不同加载不同编辑组件。

## 新建报销单入口

在 `OA600000F.vue` 中：

```javascript
addTravelExpense() {
  this.isBtnShow = false
  this.bindData = { DocType: 'CXB' }
  this.drawerShow = true
  this.dynamicComponent = 'OA600000FC'
  this.drawerTitle = '差旅报销单'
}
```

## 浏览器自动化注意事项

- "新建报销单"按钮使用 `el-dropdown`（trigger='hover'），`browser_click` 无法展开下拉菜单
- 需要通过 Vue 组件树直接调用方法，或通过 API 直接提交
- 差旅报销单以抽屉(drawer)形式打开，不是新页面
