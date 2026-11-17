import { catalogView } from './catalog.js';

const fields = ["variantId", "productId", "channel", "name", "color", "size", "mappingVersion", "observedAt"];

export async function readOperations(repository, catalogRepository) {
  const records = await repository.read();
  const view = { product: "商品目录采集器", rows: records.map((record) => ({
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
  })) };
  if (catalogRepository) view.catalog = catalogView(await catalogRepository.read());
  return view;
}
