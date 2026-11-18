# 来源与消费契约

## 来源

入口 `/catalog/channel-a` 与 `/catalog/channel-b`，JSON items 为本页项目，next 是后续相对路径或 null。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

productId 是来源商品号，variantId 是该渠道可售变体号，均非跨渠道全局编号，因此本地来源身份使用 `渠道:variantId` 作用域键。渠道 B 使用 tone/dimension 字段，原始字段保留不做归一。运营确认映射存于 decisions 台账（fixtures/decisions.json 是首批样例，fixtures/decisions-followup.json 是后续确认样例），decisionRevision 按来源键单调递增、台账只追加。**相同商品不表示相同变体；映射升级不授权撤回已有人工确认。**

## 映射与确认规则

- 归并的唯一依据是人工决策：没有当前决策的来源观察进入待确认（pending）队列，任何名称、颜色、尺码的写法相似都不会自动建立映射。
- 决策在来源键（source + variantId）上按 revision 生效，新 revision 取代当前效力但保留全部历史；低 revision 追加必须被拒绝。
- 来源映射按渠道版本（来源 mappingVersion）生效；重放旧页面只追加观察并重建派生目录，不能修改决策台账。
- 商品主档（canonicalProduct）下的每个规范变体（canonicalVariant）是独立可售与库存单元；同一商品的不同颜色/尺码不得混用库存。

## 业务消费

`readOperations(repository, catalogService?)` 在原有 product 和 rows（每行带 sourceId/source/observedAt/attributes）之外，传入目录服务时额外返回 catalog：products（商品主档）、variants（可售变体）、mappings（含来源原始字段、渠道版本与确认依据 basis）、pending（待确认队列）与 counts。`CatalogService.traceVariant` 与 `traceSource` 支持从规范变体或来源条目反查观察历史与决策历史。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。
