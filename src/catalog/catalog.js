// 从原始来源观察与人工决策台账派生业务目录。
//
// 规则（与 CONTRACT.md 对齐）：
//  - 商品主档与可售变体只由人工确认建立；名称、颜色、尺码写法相近不会自动归并。
//  - 找不到当前决策的来源观察进入 pending，等待运营确认，不猜测其规范变体。
//  - 来源映射按渠道版本（mappingVersion）生效，保留来源原始字段与确认依据。
//  - 相同商品不代表颜色尺码相同：每个规范变体是独立可售/库存单元。
// 该模块是纯函数，重放任何来源页面都只会重新派生，不会改动决策台账。

import { decisionBasis, sourceKey } from './decisions.js';

export function channelOf(record) {
  const fromAttributes = record.attributes?.channel;
  return fromAttributes == null || String(fromAttributes).trim() === ''
    ? null
    : String(fromAttributes).trim();
}

export function sourceVariantIdOf(record) {
  const fromAttributes = record.attributes?.variantId;
  return fromAttributes == null ? null : String(fromAttributes);
}

export function recordKey(record) {
  return sourceKey(channelOf(record) ?? 'unknown', sourceVariantIdOf(record) ?? record.sourceId);
}

function text(value) {
  return value == null ? null : String(value);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestObservation(records) {
  return records.reduce((latest, record) => {
    if (latest === null || Date.parse(record.observedAt) > Date.parse(latest.observedAt)) {
      return record;
    }
    return latest;
  }, null);
}

function traceHistory(records) {
  return records
    .map((record) => ({
      sourceId: record.sourceId,
      observedAt: record.observedAt,
      label: record.label,
      sourceFields: structuredClone(record.attributes ?? {}),
    }))
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
}

function buildMapping(record, decision) {
  const attributes = record.attributes ?? {};
  return {
    channel: channelOf(record),
    sourceVariantId: sourceVariantIdOf(record) ?? record.sourceId,
    channelVersion: numberOrNull(attributes.mappingVersion),
    canonicalProduct: decision.canonicalProduct,
    canonicalVariant: decision.canonicalVariant,
    status: 'confirmed',
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    sourceFields: structuredClone(attributes),
    basis: decisionBasis(decision),
  };
}

function buildPending(record) {
  const attributes = record.attributes ?? {};
  return {
    channel: channelOf(record),
    sourceVariantId: sourceVariantIdOf(record) ?? record.sourceId,
    channelVersion: numberOrNull(attributes.mappingVersion),
    status: 'pending',
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    sourceFields: structuredClone(attributes),
    reason: 'no current manual decision for this channel variant',
  };
}

// records：RecordRepository 中的观察集合；ledger：loadDecisionLedger 的结果。
export function buildCatalog(records, ledger) {
  const groups = new Map();
  for (const record of records) {
    const key = recordKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const mappings = [];
  const pending = [];
  const variantRecords = new Map(); // canonicalVariant -> { variant, records, decision }

  for (const [key, observations] of groups) {
    const record = latestObservation(observations);
    const decision = ledger.current.get(key);
    if (!decision) {
      pending.push(buildPending(record));
      continue;
    }
    const mapping = buildMapping(record, decision);
    mappings.push(mapping);
    if (!variantRecords.has(decision.canonicalVariant)) {
      variantRecords.set(decision.canonicalVariant, { records: [], decisions: new Map() });
    }
    const bucket = variantRecords.get(decision.canonicalVariant);
    bucket.records.push(record);
    bucket.decisions.set(key, decision);
  }

  const variants = [];
  const products = new Map();

  for (const [canonicalVariantId, bucket] of variantRecords) {
    const newest = latestObservation(bucket.records);
    const anyDecision = bucket.decisions.values().next().value;
    const attributes = newest.attributes ?? {};
    const variant = {
      canonicalProduct: anyDecision.canonicalProduct,
      canonicalVariant: canonicalVariantId,
      label: newest.label,
      // 颜色/尺码只展示来源观察，不做跨渠道归一；库存以规范变体为最小单元。
      observedColor: text(attributes.color ?? attributes.tone),
      observedSize: text(attributes.size ?? attributes.dimension),
      sources: [...bucket.decisions.keys()].sort(),
    };
    variants.push(variant);

    if (!products.has(variant.canonicalProduct)) {
      products.set(variant.canonicalProduct, {
        canonicalProduct: variant.canonicalProduct,
        label: newest.label,
        variants: [],
      });
    }
    products.get(variant.canonicalProduct).variants.push(canonicalVariantId);
  }

  const productList = [...products.values()]
    .map((product) => ({
      ...product,
      variants: product.variants.sort(),
    }))
    .sort((left, right) => left.canonicalProduct.localeCompare(right.canonicalProduct));

  variants.sort((left, right) => left.canonicalVariant.localeCompare(right.canonicalVariant));
  const mappingOrder = (left, right) =>
    `${left.channel}/${left.sourceVariantId}`.localeCompare(`${right.channel}/${right.sourceVariantId}`);
  mappings.sort(mappingOrder);
  pending.sort(mappingOrder);

  return {
    products: productList,
    variants,
    mappings,
    pending,
    counts: {
      records: records.length,
      products: productList.length,
      variants: variants.length,
      confirmedMappings: mappings.length,
      pending: pending.length,
    },
  };
}

// 从一个规范变体反查全部来源字段、观察历史与确认依据。
export function traceVariant(catalog, ledger, canonicalVariantId) {
  const variant = catalog.variants.find((item) => item.canonicalVariant === canonicalVariantId);
  if (!variant) return null;
  const related = catalog.mappings.filter((mapping) => mapping.canonicalVariant === canonicalVariantId);
  return {
    variant: structuredClone(variant),
    mappings: related.map((mapping) => structuredClone(mapping)),
    decisionHistory: related
      .map((mapping) => {
        const key = sourceKey(mapping.channel, mapping.sourceVariantId);
        return ledger.entries
          .filter((entry) => entry.key === key)
          .map((entry) => ({ source: entry.source, sourceVariantId: entry.variantId, ...decisionBasis(entry) }));
      })
      .flat()
      .sort((left, right) =>
        `${left.source}/${left.sourceVariantId}`.localeCompare(`${right.source}/${right.sourceVariantId}`)
        || left.decisionRevision - right.decisionRevision),
  };
}

// 从一条来源观察反查其当前映射状态与全部观察历史。
export function traceSource(catalog, ledger, records, channel, sourceVariantId) {
  const key = sourceKey(channel, sourceVariantId);
  const history = traceHistory(records.filter((record) => recordKey(record) === key));
  if (history.length === 0) return null;
  const mapping = catalog.mappings.find((item) => item.channel === channel && item.sourceVariantId === sourceVariantId) ?? null;
  const queued = catalog.pending.find((item) => item.channel === channel && item.sourceVariantId === sourceVariantId) ?? null;
  const decisionHistory = ledger.entries
    .filter((entry) => entry.key === key)
    .map((entry) => decisionBasis(entry));
  return {
    key,
    status: mapping ? 'confirmed' : 'pending',
    current: mapping ? structuredClone(mapping) : structuredClone(queued),
    observationHistory: history,
    decisionHistory,
  };
}
