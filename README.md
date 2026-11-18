# 商品目录采集器

Node.js 本地数据接入项目。在原有来源读取、结构化导入与操作查询之上，新增商品主档、可售变体与渠道来源映射管理：跨渠道写法差异（如“红/M”与“scarlet/medium”）不会被自动猜测为同一变体，只有运营人工确认才能建立归并；确认依据可从变体反查，且渠道映射升级、旧页面重放都不会撤销人工决定。

## 运行

需要 Node.js 22，无第三方包、远程服务或账户凭据。`npm test` 运行全部单元与集成测试；`npm run demo` 启动临时来源、双渠道采集、人工确认、来源升级重放与反查演示，结束时自动清理临时数据，通常两秒内完成。`npm run acceptance` 在临时目录中端到端验证完整生命周期。演示数据不访问生产站点。

## 命令

`npm start -- <命令> [参数] [--state-dir 目录]`，默认状态目录为 `var/`：

- `ingest [文件]`：导入来源观察（默认 `fixtures/records.json`），更新最新集合并追加观察流水，随后重建派生目录。
- `query [来源]`：读取原始观察集合（现有行为不变）。
- `decide <决策文件>`：追加人工确认，同一来源键的 `decisionRevision` 必须严格递增；低版本追加会被拒绝且不落盘。
- `catalog`：查看商品主档、可售变体、按渠道版本生效的来源映射与计数。
- `pending`：查看无法可靠对应、留待人工确认的来源条目。
- `trace <规范变体ID>`：反查该变体的全部来源字段、各渠道版本观察历史与确认依据。

## 领域模型与状态文件

状态目录下四类文件职责分离，采集流程只能写前两类，无法重写决策台账：

- `records.json`：每个来源键（`渠道:变体号`）的最新观察，沿用现有集合与合并语义。
- `observations.json`：只追加的来源观察流水，保留各渠道版本（`mappingVersion`）的原始字段，支撑来源反查。
- `decisions.json`：只追加的人工确认台账，按 `source` + `variantId` 归组、`decisionRevision` 单调递增；新修订取代当前效力，旧条目保留为确认依据。
- `catalog.json`：派生目录物化视图，由观察与台账随时重建，重启后读取一致状态。

派生规则（见 `src/catalog/`）：

1. 找不到当前人工决策的来源观察一律进入 `pending`，系统不做任何名称、颜色、尺码相似度匹配。
2. 人工确认建立商品主档（`canonicalProduct`）与可售变体（`canonicalVariant`）；同一商品下不同颜色/尺码是独立可售与库存单元，不混用库存。
3. 来源映射按渠道版本生效，记录来源原始字段（A 渠道 `color/size`、B 渠道 `tone/dimension` 原样保留）与确认依据。
4. 重放旧页面只追加观察并重新派生目录；决策台账仅由 `decide` 追加，因此人工决定不会被采集撤销。

## 组件和数据

`source/server.js` 读取 `fixtures/source.json` 并监听随机回环端口，`opening` 与 `updated` 是两个可切换的来源观察。`src/source-client.js` 只接受同一回环来源；`src/adapter.js` 解析 A（`/catalog/channel-a`）、B（`/catalog/channel-b`）页面，`sourceId` 带渠道作用域并保留全部原始属性。`src/catalog/decisions.js` 负责台账校验与修订管理，`src/catalog/catalog.js` 是无副作用的目录派生与反查逻辑，`src/catalog/catalog-service.js` 编排采集、决策与物化视图，`src/operations.js` 是业务消费入口，来源协议见 [CONTRACT.md](CONTRACT.md)。

状态目录属于运行产物。扩展导入时保留了现有 CLI 与集合查询能力；新增状态在同一状态目录下另行组织。测试可直接使用随机端口来源，不需要等待真实时间或接入外网。
