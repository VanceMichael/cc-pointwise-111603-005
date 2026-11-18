import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDecisionLedger, appendDecisions, normalizeDecision } from '../src/catalog/decisions.js';
import { buildCatalog, traceVariant, traceSource } from '../src/catalog/catalog.js';
import { DecisionRepository } from '../src/catalog/decision-repository.js';
import { CatalogService } from '../src/catalog/catalog-service.js';
import { ObservationJournal } from '../src/catalog/observation-journal.js';
import { RecordRepository } from '../src/repository.js';
import { readOperations } from '../src/operations.js';

const record = (channel, variantId, observedAt, attributes) => ({
  sourceId: `${channel}:${variantId}`,
  source: '商品目录采集器',
  observedAt,
  label: attributes.name,
  attributes: { variantId, channel, observedAt, ...attributes },
});

const decision = (overrides = {}) => ({
  source: 'b',
  variantId: 'b-17',
  canonicalProduct: 'shirt',
  canonicalVariant: 'red-medium',
  decisionRevision: 1,
  confirmedBy: 'operator-local',
  confirmedAt: '2026-11-16T10:00:00Z',
  ...overrides,
});

const shirtRecords = [
  record('a', 'a-red-m', '2026-11-16T08:00:00Z', {
    productId: 'P1', name: '衬衫', color: '红', size: 'M', mappingVersion: 1,
  }),
  record('b', 'b-17', '2026-11-16T08:00:00Z', {
    productId: 'shirt', name: '衬衫', tone: 'red', dimension: 'M', mappingVersion: 1,
  }),
  record('b', 'b-18', '2026-11-16T08:00:00Z', {
    productId: 'shirt', name: '衬衫', tone: 'blue', dimension: 'L', mappingVersion: 1,
  }),
];

test('没有人工决策时全部进入待确认，且不会建立任何主档或变体', () => {
  const catalog = buildCatalog(shirtRecords, loadDecisionLedger([]));
  assert.equal(catalog.products.length, 0);
  assert.equal(catalog.variants.length, 0);
  assert.equal(catalog.mappings.length, 0);
  assert.deepEqual(catalog.pending.map((item) => item.sourceId).sort(),
    ['a:a-red-m', 'b:b-17', 'b:b-18']);
  assert.ok(catalog.pending.every((item) => item.status === 'pending' && item.reason));
});

test('人工确认建立主档、可售变体和按渠道版本生效的来源映射', () => {
  const ledger = loadDecisionLedger([
    decision({ source: 'a', variantId: 'a-red-m' }),
    decision({ variantId: 'b-17' }),
    decision({ variantId: 'b-18', canonicalVariant: 'blue-large' }),
  ]);
  const catalog = buildCatalog(shirtRecords, ledger);
  assert.equal(catalog.pending.length, 0);
  assert.deepEqual(catalog.products.map((item) => item.canonicalProduct), ['shirt']);
  assert.deepEqual(catalog.products[0].variants, ['blue-large', 'red-medium']);
  assert.deepEqual(catalog.variants.map((item) => item.canonicalVariant).sort(),
    ['blue-large', 'red-medium']);
  const aMapping = catalog.mappings.find((item) => item.channel === 'a');
  assert.equal(aMapping.channelVersion, 1);
  assert.equal(aMapping.canonicalVariant, 'red-medium');
  assert.equal(aMapping.basis.confirmedBy, 'operator-local');
  // B 渠道 tone/dimension 原始字段保留，未做颜色尺码归一。
  assert.equal(aMapping.sourceFields.color, '红');
  const bMapping = catalog.mappings.find((item) => item.channel === 'b' && item.sourceVariantId === 'b-17');
  assert.equal(bMapping.sourceFields.tone, 'red');
  assert.equal(bMapping.sourceFields.dimension, 'M');
});

test('相同商品的不同颜色尺码是独立可售变体，不混用库存', () => {
  const ledger = loadDecisionLedger([
    decision({ source: 'a', variantId: 'a-red-m' }),
    decision({ variantId: 'b-18', canonicalVariant: 'blue-large' }),
  ]);
  const catalog = buildCatalog(shirtRecords, ledger);
  const variants = catalog.variants.map((item) => item.canonicalVariant);
  assert.ok(variants.includes('red-medium'));
  assert.ok(variants.includes('blue-large'));
  const blue = catalog.variants.find((item) => item.canonicalVariant === 'blue-large');
  assert.notDeepEqual(blue.sources, ['a:a-red-m']);
});

test('decisionRevision 必须单调递增，低版本追加被拒绝', () => {
  assert.throws(() => loadDecisionLedger([
    decision({ source: 'a', variantId: 'a-red-m', decisionRevision: 2 }),
    decision({ source: 'a', variantId: 'a-red-m', decisionRevision: 1 }),
  ]), /must increase/);
  assert.throws(() => normalizeDecision({ ...decision(), decisionRevision: 0 }), /positive integer/);
  const ledger = loadDecisionLedger([
    decision({ source: 'a', variantId: 'a-red-m', decisionRevision: 1 }),
  ]);
  assert.throws(
    () => appendDecisions(ledger.entries, [decision({ source: 'a', variantId: 'a-red-m', decisionRevision: 1 })]),
    /must be greater than 1/,
  );
});

test('新修订取代当前效力但保留全部确认历史', () => {
  const ledger = loadDecisionLedger([
    decision({ source: 'a', variantId: 'a-red-m', decisionRevision: 1, canonicalVariant: 'old-variant' }),
    decision({ source: 'a', variantId: 'a-red-m', decisionRevision: 3, canonicalVariant: 'red-medium' }),
  ]);
  assert.equal(ledger.current.get('a:a-red-m').canonicalVariant, 'red-medium');
  assert.equal(ledger.entries.length, 2);
  const catalog = buildCatalog(shirtRecords, ledger);
  const trace = traceVariant(catalog, ledger, 'red-medium');
  assert.deepEqual(trace.decisionHistory.map((item) => item.decisionRevision), [1, 3]);
});

test('渠道映射升级后重放旧页面不撤销人工决定，映射随渠道版本更新', () => {
  const ledger = loadDecisionLedger([decision({ source: 'a', variantId: 'a-red-m' })]);
  const opening = buildCatalog(shirtRecords, ledger);
  assert.equal(opening.mappings[0].channelVersion, 1);

  const upgraded = [
    record('a', 'a-red-m', '2026-11-16T09:00:00Z', {
      productId: 'P1', name: '衬衫', color: 'scarlet', size: 'medium', mappingVersion: 2,
    }),
    ...shirtRecords.slice(1),
  ];
  const reprocessed = buildCatalog(upgraded, ledger);
  const mapping = reprocessed.mappings.find((item) => item.channel === 'a');
  assert.equal(mapping.canonicalVariant, 'red-medium');
  assert.equal(mapping.channelVersion, 2);
  assert.equal(mapping.sourceFields.color, 'scarlet');
  assert.equal(mapping.basis.decisionRevision, 1);
  assert.deepEqual(reprocessed.pending.map((item) => item.sourceId).sort(), ['b:b-17', 'b:b-18']);
});

test('traceVariant 与 traceSource 反查来源字段、观察历史和确认依据', () => {
  const ledger = loadDecisionLedger([
    decision({ source: 'a', variantId: 'a-red-m' }),
    decision({ variantId: 'b-17' }),
  ]);
  const records = [
    ...shirtRecords,
    record('a', 'a-red-m', '2026-11-16T09:00:00Z', {
      productId: 'P1', name: '衬衫', color: 'scarlet', size: 'medium', mappingVersion: 2,
    }),
  ];
  const catalog = buildCatalog(records, ledger);
  const trace = traceVariant(catalog, ledger, 'red-medium');
  assert.deepEqual(trace.variant.sources.sort(), ['a:a-red-m', 'b:b-17']);
  assert.equal(trace.mappings.length, 2);
  const sourceTrace = traceSource(catalog, ledger, records, 'a', 'a-red-m');
  assert.equal(sourceTrace.status, 'confirmed');
  assert.equal(sourceTrace.observationHistory.length, 2);
  assert.deepEqual(
    sourceTrace.observationHistory.map((item) => item.sourceFields.color),
    ['红', 'scarlet'],
  );
  assert.equal(sourceTrace.decisionHistory[0].confirmedBy, 'operator-local');
  assert.equal(traceSource(catalog, ledger, records, 'b', 'b-18').status, 'pending');
  assert.equal(traceVariant(catalog, ledger, 'missing'), null);
  assert.equal(traceSource(catalog, ledger, records, 'b', 'missing'), null);
});

test('CatalogService 落盘、重启回读与决策追加的完整生命周期', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-service-'));
  try {
    const records = new RecordRepository(join(directory, 'records.json'));
    const decisions = new DecisionRepository(join(directory, 'decisions.json'));
    const service = new CatalogService(records, decisions, null);
    await new (await import('../src/service.js')).CollectionService(records).ingest(shirtRecords);
    let catalog = await service.refresh();
    assert.equal(catalog.counts.pending, 3);

    catalog = await service.applyDecisions([decision({ source: 'a', variantId: 'a-red-m' })]);
    assert.equal(catalog.counts.confirmedMappings, 1);
    assert.equal(catalog.counts.pending, 2);

    const restarted = new CatalogService(
      new RecordRepository(join(directory, 'records.json')),
      new DecisionRepository(join(directory, 'decisions.json')),
      null,
    );
    const reloaded = await restarted.catalog();
    assert.equal(reloaded.mappings[0].canonicalVariant, 'red-medium');
    assert.equal((await restarted.pending()).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('观察流水保留各渠道版本的原始字段，重放后仍可反查历史写法', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-journal-'));
  try {
    const records = new RecordRepository(join(directory, 'records.json'));
    const decisions = new DecisionRepository(join(directory, 'decisions.json'));
    const journal = new ObservationJournal(join(directory, 'observations.json'));
    const service = new CatalogService(records, decisions, null, journal);
    const collection = new (await import('../src/service.js')).CollectionService(records);

    await collection.ingest(shirtRecords);
    await service.recordObservation(shirtRecords);
    const upgraded = record('a', 'a-red-m', '2026-11-16T09:00:00Z', {
      productId: 'P1', name: '衬衫', color: 'scarlet', size: 'medium', mappingVersion: 2,
    });
    await collection.ingest([upgraded]);
    await service.recordObservation([upgraded]);
    await service.applyDecisions([decision({ source: 'a', variantId: 'a-red-m' })]);

    const history = await journal.history('a:a-red-m');
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((item) => item.sourceFields.color), ['红', 'scarlet']);

    const trace = await service.traceSource('a', 'a-red-m');
    assert.equal(trace.observationHistory.length, 2);
    assert.equal(trace.current.channelVersion, 2);
    const variantTrace = await service.traceVariant('red-medium');
    assert.equal(variantTrace.mappings[0].observationHistory.length, 2);

    // 流水只追加：重放首批不会删除已有历史。
    await service.recordObservation(shirtRecords);
    assert.equal((await journal.read()).length, 7);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('业务读取入口在目录服务接入后暴露一致状态', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-ops-'));
  try {
    const records = new RecordRepository(join(directory, 'records.json'));
    const decisions = new DecisionRepository(join(directory, 'decisions.json'));
    const service = new CatalogService(records, decisions, null);
    const collection = new (await import('../src/service.js')).CollectionService(records);
    await collection.ingest(shirtRecords);
    await service.applyDecisions([
      decision({ source: 'a', variantId: 'a-red-m' }),
      decision({ variantId: 'b-17' }),
    ]);
    const view = await readOperations(records, service);
    assert.equal(view.rows.length, 3);
    assert.equal(view.catalog.counts.variants, 1);
    assert.equal(view.catalog.pending.length, 1);
    assert.equal(view.rows[0].attributes.tone ?? null, null);
    const legacy = await readOperations(records);
    assert.equal(legacy.catalog, undefined);
    assert.equal(legacy.rows.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
