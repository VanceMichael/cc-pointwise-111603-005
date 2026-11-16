export const entryPath = "/catalog/channel-a";

export function parsePage(response) {
  const payload = JSON.parse(response.text);
  if (!Array.isArray(payload.items)) throw new Error('source items missing');
  const items = payload.items;
  const next = payload.next ?? null;
  return { next, records: items.map((item) => ({
    sourceId: String(item["variantId"]),
    source: "商品目录采集器",
    observedAt: item["observedAt"],
    label: String(item["name"]),
    attributes: structuredClone(item),
  })) };
}
