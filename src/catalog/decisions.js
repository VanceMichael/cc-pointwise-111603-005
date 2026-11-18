// 人工确认决策台账。
// 决策是渠道可售变体归并到规范变体的唯一依据：
// 名称、颜色、尺码的相似写法永远不会自动产生或修改映射。
// 台账只追加、不删除、不覆盖；同一来源键的 decisionRevision 必须严格递增，
// 新版本取代旧版本的当前效力，旧条目保留作为确认依据。

export function sourceKey(channel, sourceVariantId) {
  return `${String(channel).trim()}:${String(sourceVariantId).trim()}`;
}

const requiredText = [
  'source',
  'variantId',
  'canonicalProduct',
  'canonicalVariant',
  'confirmedBy',
  'confirmedAt',
];

export function normalizeDecision(input, index = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`decision ${index} must be an object`);
  }
  const entry = {
    decisionId: input.decisionId == null ? null : String(input.decisionId),
    source: String(input.source ?? '').trim(),
    variantId: String(input.variantId ?? '').trim(),
    canonicalProduct: String(input.canonicalProduct ?? '').trim(),
    canonicalVariant: String(input.canonicalVariant ?? '').trim(),
    decisionRevision: Number(input.decisionRevision),
    confirmedBy: String(input.confirmedBy ?? '').trim(),
    confirmedAt: String(input.confirmedAt ?? '').trim(),
    note: input.note == null ? null : String(input.note),
  };
  for (const field of requiredText) {
    if (!entry[field]) throw new Error(`decision ${index} missing ${field}`);
  }
  if (!Number.isInteger(entry.decisionRevision) || entry.decisionRevision < 1) {
    throw new Error(`decision ${index} decisionRevision must be a positive integer`);
  }
  if (Number.isNaN(Date.parse(entry.confirmedAt))) {
    throw new Error(`decision ${index} invalid confirmedAt`);
  }
  entry.key = sourceKey(entry.source, entry.variantId);
  return entry;
}

// 载入并校验完整台账，返回按时间顺序排列的条目与每个来源键的当前决策。
export function loadDecisionLedger(rawEntries) {
  if (!Array.isArray(rawEntries)) throw new TypeError('decisions must be an array');
  const entries = rawEntries.map((entry, index) => normalizeDecision(entry, index));
  const maxRevision = new Map();
  for (const entry of entries) {
    const previous = maxRevision.get(entry.key);
    if (previous !== undefined && entry.decisionRevision <= previous) {
      throw new Error(
        `decision revision for ${entry.key} must increase: ${entry.decisionRevision} <= ${previous}`,
      );
    }
    maxRevision.set(entry.key, entry.decisionRevision);
  }
  entries.sort((left, right) => {
    const byKey = left.key.localeCompare(right.key);
    return byKey !== 0 ? byKey : left.decisionRevision - right.decisionRevision;
  });
  const current = new Map();
  for (const entry of entries) current.set(entry.key, entry);
  return { entries, current, keys: () => current.keys() };
}

// 在既有台账后追加新决策；同一来源键只接受更高 revision。
export function appendDecisions(existingEntries, incomingEntries) {
  const ledger = loadDecisionLedger(existingEntries);
  const additions = incomingEntries.map((entry, index) => normalizeDecision(entry, index));
  const maxRevision = new Map(
    ledger.entries.map((entry) => [entry.key, entry.decisionRevision]),
  );
  for (const entry of additions) {
    const previous = maxRevision.get(entry.key);
    if (previous !== undefined && entry.decisionRevision <= previous) {
      throw new Error(
        `decision revision for ${entry.key} must be greater than ${previous}`,
      );
    }
    maxRevision.set(entry.key, entry.decisionRevision);
  }
  return loadDecisionLedger([...ledger.entries, ...additions]);
}

export function decisionBasis(entry) {
  return {
    decisionId: entry.decisionId,
    decisionRevision: entry.decisionRevision,
    confirmedBy: entry.confirmedBy,
    confirmedAt: entry.confirmedAt,
    note: entry.note,
  };
}
