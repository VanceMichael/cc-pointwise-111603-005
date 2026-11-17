# 来源与消费契约

## 来源

入口 `/catalog/channel-a`，JSON items 为本页项目，next 是后续相对路径或 null。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

productId 是来源商品号，variantId 是该渠道可售变体号，均非跨渠道全局编号。渠道 B 使用 tone/dimension 字段，运营确认映射存于 fixtures/decisions.json，decisionRevision 单调递增。相同商品不表示相同变体；映射升级不授权撤回已有人工确认。

## 目录主档与映射

采集在记录集合之外维护商品主档（canonicalProduct）、可售变体（canonicalVariant）与来源映射，持久于独立目录状态。来源映射按 (channel, variantId, mappingVersion) 生效：同一渠道变体在不同 mappingVersion 下各自保留来源字段与解析结果，重新处理旧版本页面只影响对应版本的映射，不影响其他版本。

人工决定按 (channel, variantId) 记录，只能被更高 decisionRevision 的决定取代；采集、重放与映射升级都不修改、不撤回已有决定。没有决定覆盖的条目保持 pending，不按名称或属性相似度猜测归并。库存以可售变体为单位：相同 canonicalProduct 下不同 canonicalVariant 不混用库存。每个规范变体可反查其来源映射的来源字段与确认依据（decisionRevision、confirmedBy）。

## 业务消费

`readOperations(repository)` 当前返回 product 和 rows，每行带 sourceId/source/observedAt/attributes；传入可选的目录仓库时附带一致的目录视图（inventoryUnit 为 canonicalVariant）。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。
