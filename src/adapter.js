// 来源页面解析。渠道 A 使用 color/size，渠道 B 使用 tone/dimension，
// 原始字段原样保留在 attributes 中，适配器不做颜色/尺码归一。
export const entryPath = '/catalog/channel-a';
export const channelEntryPaths = Object.freeze({
  a: '/catalog/channel-a',
  b: '/catalog/channel-b',
});

function channelFromPath(path) {
  const match = String(path).match(/\/catalog\/channel-([^/]+)/);
  return match ? match[1] : null;
}

export function parsePage(response, path = entryPath) {
  const payload = JSON.parse(response.text);
  if (!Array.isArray(payload.items)) throw new Error('source items missing');
  const items = payload.items;
  const next = payload.next ?? null;
  const pathChannel = channelFromPath(path);
  return { next, records: items.map((item) => {
    const channel = item.channel == null || String(item.channel).trim() === ''
      ? pathChannel
      : String(item.channel).trim();
    const sourceVariantId = String(item.variantId);
    return {
      // variantId 仅在渠道内唯一，来源身份必须带渠道作用域。
      sourceId: `${channel}:${sourceVariantId}`,
      source: '商品目录采集器',
      observedAt: item.observedAt,
      label: String(item.name),
      attributes: structuredClone(item),
    };
  }) };
}
