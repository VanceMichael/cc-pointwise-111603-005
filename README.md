# 商品目录采集器

Node.js 本地数据接入项目。已有一次来源读取、结构化导入与操作查询，来源服务和业务存储独立，来源变化不会自动刷新本地集合。导入在记录集合之外维护商品主档、可售变体与按渠道版本生效的来源映射；人工确认决定单调生效，重新处理旧页面不会撤销后来的决定。完整批次与恢复流程尚未纳入接入生命周期。

## 运行

需要 Node.js 22，无第三方包、远程服务或账户凭据。`npm test` 运行现有行为与本地接口测试；`npm run demo` 启动临时来源、应用运营决定、采集两个渠道、模拟渠道映射升级并重放旧页面，展示业务查询与变体反查，结束时自动关闭监听并清理临时数据，通常两秒内完成。`npm start -- ingest` 从 `fixtures/records.json` 导入记录集合，`npm start -- query` 读取本地 `var/records.json`。演示数据不访问生产站点。

## 组件和数据

`source/server.js` 读取 `fixtures/source.json` 并监听随机回环端口。`startSource()` 返回 url、publish(stage)、failNext(path,status) 和 close()；publish 切换可观察来源版本而不修改业务仓库，failNext 可返回 503 或使用 disconnect 断开连接。它记录请求路径并支持来源 ETag/304。`src/source-client.js` 只接受同一回环来源；`src/adapter.js` 解析现有首批页面并保留原始来源属性，返回 records 和 next；目前 demo 只导入首批。`src/service.js` 与 `src/repository.js` 维护持久记录集合；`src/operations.js` 是读取该集合的业务消费入口，来源协议见 [CONTRACT.md](CONTRACT.md)。

目录管理由 `src/catalog.js`（领域逻辑）、`src/catalog-repository.js`（持久化 `var/catalog.json`）与 `src/catalog-service.js`（采集编排）组成。来源映射按 (channel, variantId, mappingVersion) 生效，每个渠道版本各自保留来源字段与解析结果；人工决定按 (channel, variantId) 记录、decisionRevision 单调递增，只能被更高 revision 取代，采集与重放不修改决定。没有决定覆盖的条目保持 pending，系统不按名称或属性相似度猜测归并；库存以可售变体为单位，相同商品的不同变体不混用。

状态目录属于运行产物（可用 `STATE_DIR` 环境变量改到其他目录）。扩展导入时应保留现有 CLI 和现有集合查询能力；新增状态可以另行组织。测试可直接使用随机端口来源，不需要等待真实时间或接入外网。运行录制可用 test 和 demo，无需安装浏览器或外部数据库。

`npm start` 或 `npm start -- --help` 查看命令。除原有 ingest、query 外：`collect <文件>` 采集来源页面或记录文件（同时写入记录集合与目录），`decide [文件]` 应用运营确认决定（默认 `fixtures/decisions.json`），`catalog` 查看商品主档、可售变体、来源映射与待确认条目，`trace <变体>` 从规范变体反查来源字段与确认依据。`npm run acceptance` 在临时目录中验证本地来源读取、首批导入、重启回读、重放、业务查询以及目录决定单调性、按版本映射与待确认行为，完成后清理临时状态。
