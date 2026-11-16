export const schema = Object.freeze({
  "product": "商品目录采集器",
  "entity": "商品条目",
  "identity": "sourceId",
  "required": [
    "sourceId",
    "source",
    "observedAt",
    "label"
  ],
  "description": "商品变体目录的跨源归并"
});
