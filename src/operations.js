const fields = ["variantId", "productId", "channel", "name", "color", "size", "mappingVersion", "observedAt"];

export async function readOperations(repository) {
  const records = await repository.read();
  return { product: "商品目录采集器", rows: records.map((record) => ({
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
  })) };
}
