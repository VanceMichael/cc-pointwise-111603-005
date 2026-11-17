const MAPPING_META = new Set(['channel', 'variantId', 'mappingVersion', 'observedAt']);

export function emptyCatalog() {
  return { decisionRevision: 0, decisions: [], products: [], variants: [], mappings: [] };
}

export function normalizeDecision(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('mapping decision must be an object');
  }
  const decision = {
    channel: String(input.source ?? input.channel ?? '').trim(),
    variantId: String(input.variantId ?? '').trim(),
    canonicalProduct: String(input.canonicalProduct ?? '').trim(),
    canonicalVariant: String(input.canonicalVariant ?? '').trim(),
    decisionRevision: input.decisionRevision,
    confirmedBy: String(input.confirmedBy ?? '').trim(),
  };
  for (const field of ['channel', 'variantId', 'canonicalProduct', 'canonicalVariant', 'confirmedBy']) {
    if (!decision[field]) throw new Error(`missing ${field} for mapping decision`);
  }
  if (!Number.isInteger(decision.decisionRevision) || decision.decisionRevision < 1) {
    throw new Error(`invalid decisionRevision for mapping decision ${decision.channel}/${decision.variantId}`);
  }
  return decision;
}

export function normalizeObservedItem(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('observed item must be an object');
  }
  const item = {
    channel: String(input.channel ?? '').trim(),
    variantId: String(input.variantId ?? '').trim(),
    mappingVersion: input.mappingVersion,
    observedAt: String(input.observedAt ?? '').trim(),
  };
  for (const field of ['channel', 'variantId']) {
    if (!item[field]) throw new Error(`missing ${field} for observed item`);
  }
  if (!Number.isInteger(item.mappingVersion) || item.mappingVersion < 1) {
    throw new Error(`invalid mappingVersion for observed item ${item.channel}/${item.variantId}`);
  }
  if (!Number.isFinite(Date.parse(item.observedAt))) {
    throw new Error(`invalid observedAt for observed item ${item.channel}/${item.variantId}`);
  }
  return item;
}

function findDecision(decisions, channel, variantId) {
  return decisions.find((decision) => decision.channel === channel && decision.variantId === variantId) ?? null;
}

function resolutionFor(decision) {
  if (!decision) {
    return { status: 'pending', canonicalProduct: null, canonicalVariant: null, basis: null };
  }
  return {
    status: 'confirmed',
    canonicalProduct: decision.canonicalProduct,
    canonicalVariant: decision.canonicalVariant,
    basis: { decisionRevision: decision.decisionRevision, confirmedBy: decision.confirmedBy },
  };
}

function resolveMappings(state) {
  for (const mapping of state.mappings) {
    Object.assign(mapping, resolutionFor(findDecision(state.decisions, mapping.channel, mapping.variantId)));
  }
}

function rebuildMaster(state) {
  const products = new Map();
  const variants = new Map();
  const byRevision = [...state.decisions].sort((left, right) => left.decisionRevision - right.decisionRevision);
  for (const decision of byRevision) {
    if (!products.has(decision.canonicalProduct)) products.set(decision.canonicalProduct, { productId: decision.canonicalProduct });
    variants.set(decision.canonicalVariant, { variantId: decision.canonicalVariant, productId: decision.canonicalProduct });
  }
  state.products = [...products.values()].sort((left, right) => left.productId.localeCompare(right.productId));
  state.variants = [...variants.values()].sort((left, right) => left.variantId.localeCompare(right.variantId));
}

function sortMappings(mappings) {
  mappings.sort((left, right) =>
    left.channel.localeCompare(right.channel) ||
    left.variantId.localeCompare(right.variantId) ||
    left.mappingVersion - right.mappingVersion);
}

export function applyDecisions(state, inputs) {
  if (!Array.isArray(inputs)) throw new TypeError('decisions input must be an array');
  const next = structuredClone(state);
  let applied = 0;
  let skipped = 0;
  for (const input of inputs) {
    const decision = normalizeDecision(input);
    const existing = findDecision(next.decisions, decision.channel, decision.variantId);
    if (existing && existing.decisionRevision >= decision.decisionRevision) { skipped += 1; continue; }
    if (existing) next.decisions.splice(next.decisions.indexOf(existing), 1);
    next.decisions.push(decision);
    applied += 1;
  }
  next.decisions.sort((left, right) => left.channel.localeCompare(right.channel) || left.variantId.localeCompare(right.variantId));
  next.decisionRevision = next.decisions.reduce((max, decision) => Math.max(max, decision.decisionRevision), 0);
  rebuildMaster(next);
  resolveMappings(next);
  return { state: next, applied, skipped };
}

export function observeItems(state, inputs) {
  if (!Array.isArray(inputs)) throw new TypeError('observe input must be an array');
  const next = structuredClone(state);
  for (const input of inputs) {
    const item = normalizeObservedItem(input);
    const sourceFields = {};
    for (const [key, value] of Object.entries(input)) {
      if (!MAPPING_META.has(key)) sourceFields[key] = structuredClone(value);
    }
    const existing = next.mappings.find((mapping) =>
      mapping.channel === item.channel &&
      mapping.variantId === item.variantId &&
      mapping.mappingVersion === item.mappingVersion);
    if (!existing) {
      next.mappings.push({
        channel: item.channel,
        variantId: item.variantId,
        mappingVersion: item.mappingVersion,
        observedAt: item.observedAt,
        sourceFields,
        status: 'pending',
        canonicalProduct: null,
        canonicalVariant: null,
        basis: null,
      });
    } else if (Date.parse(item.observedAt) >= Date.parse(existing.observedAt)) {
      existing.observedAt = item.observedAt;
      existing.sourceFields = sourceFields;
    }
  }
  resolveMappings(next);
  sortMappings(next.mappings);
  const confirmed = next.mappings.filter((mapping) => mapping.status === 'confirmed').length;
  return { state: next, observed: inputs.length, confirmed, pending: next.mappings.length - confirmed };
}

export function catalogView(state) {
  const variants = state.variants.map((variant) => ({
    ...structuredClone(variant),
    sources: state.mappings
      .filter((mapping) => mapping.status === 'confirmed' && mapping.canonicalVariant === variant.variantId)
      .map((mapping) => ({
        channel: mapping.channel,
        variantId: mapping.variantId,
        mappingVersion: mapping.mappingVersion,
        observedAt: mapping.observedAt,
        basis: structuredClone(mapping.basis),
      })),
  }));
  const products = state.products.map((product) => ({
    ...structuredClone(product),
    variants: variants.filter((variant) => variant.productId === product.productId).map((variant) => variant.variantId),
  }));
  const pending = state.mappings
    .filter((mapping) => mapping.status === 'pending')
    .map((mapping) => ({
      channel: mapping.channel,
      variantId: mapping.variantId,
      mappingVersion: mapping.mappingVersion,
      observedAt: mapping.observedAt,
      sourceFields: structuredClone(mapping.sourceFields),
    }));
  return { inventoryUnit: 'canonicalVariant', decisionRevision: state.decisionRevision, products, variants, pending };
}

export function traceVariant(state, canonicalVariant) {
  const variant = state.variants.find((entry) => entry.variantId === canonicalVariant);
  if (!variant) return null;
  return {
    variant: structuredClone(variant),
    sources: state.mappings
      .filter((mapping) => mapping.canonicalVariant === canonicalVariant)
      .map((mapping) => ({
        channel: mapping.channel,
        variantId: mapping.variantId,
        mappingVersion: mapping.mappingVersion,
        status: mapping.status,
        observedAt: mapping.observedAt,
        sourceFields: structuredClone(mapping.sourceFields),
        basis: structuredClone(mapping.basis),
      })),
    decisions: state.decisions
      .filter((decision) => decision.canonicalVariant === canonicalVariant)
      .map((decision) => structuredClone(decision)),
  };
}
