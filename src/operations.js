import { loadDecisionLedger } from './catalog/decisions.js';
import { buildCatalog } from './catalog/catalog.js';

const fields = ['variantId', 'productId', 'channel', 'name', 'color', 'size', 'tone', 'dimension', 'mappingVersion', 'observedAt'];

// 业务消费入口。传入 CatalogService 时返回与派生目录一致的状态；
// 仅传 repository 时保持原有 rows 行为，并以空决策台账标注全部来源为待确认。
export async function readOperations(repository, catalogService = null) {
  const records = await repository.read();
  const rows = records.map((record) => ({
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
  }));
  const base = { product: '商品目录采集器', rows };
  if (!catalogService) return base;

  const catalog = await catalogService.catalog();
  return {
    ...base,
    catalog: {
      products: catalog.products,
      variants: catalog.variants,
      mappings: catalog.mappings,
      pending: catalog.pending,
      counts: catalog.counts,
    },
  };
}

// 供只持有 repository 的离线场景重建目录（例如测试与旧脚本）。
export async function readCatalog(repository, decisionEntries = []) {
  const [records, ledger] = await Promise.all([
    repository.read(),
    Promise.resolve(loadDecisionLedger(decisionEntries)),
  ]);
  return buildCatalog(records, ledger);
}
