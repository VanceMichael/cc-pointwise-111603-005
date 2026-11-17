import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyCatalog, normalizeDecision, applyDecisions, observeItems, catalogView, traceVariant,
} from '../src/catalog.js';
import { CatalogRepository } from '../src/catalog-repository.js';
import { CatalogService } from '../src/catalog-service.js';

const decision = (overrides = {}) => ({
  source: 'a',
  variantId: 'a-red-m',
  canonicalProduct: 'shirt',
  canonicalVariant: 'red-medium',
  decisionRevision: 2,
  confirmedBy: 'operator-local',
  ...overrides,
});

const item = (overrides = {}) => ({
  channel: 'a',
  variantId: 'a-red-m',
  productId: 'P1',
  name: '衬衫',
  color: '红',
  size: 'M',
  mappingVersion: 1,
  observedAt: '2026-11-16T08:00:00Z',
  ...overrides,
});

test('decision validation requires identity, canonical targets, and a positive revision', () => {
  const normalized = normalizeDecision(decision());
  assert.equal(normalized.channel, 'a');
  assert.throws(() => normalizeDecision(decision({ canonicalVariant: '' })), /missing canonicalVariant/);
  assert.throws(() => normalizeDecision(decision({ decisionRevision: 0 })), /invalid decisionRevision/);
  assert.throws(() => normalizeDecision(decision({ confirmedBy: '' })), /missing confirmedBy/);
});

test('decisions are monotonic: older or equal revisions never replace a stored one', () => {
  const first = applyDecisions(emptyCatalog(), [decision()]).state;
  const replayed = applyDecisions(first, [decision({ decisionRevision: 1, canonicalVariant: 'other' })]);
  assert.equal(replayed.applied, 0);
  assert.equal(replayed.skipped, 1);
  assert.equal(replayed.state.decisionRevision, 2);
  assert.deepEqual(replayed.state.variants, [{ variantId: 'red-medium', productId: 'shirt' }]);
  const revised = applyDecisions(first, [decision({ decisionRevision: 5, canonicalVariant: 'crimson-medium' })]);
  assert.equal(revised.state.decisionRevision, 5);
  assert.deepEqual(revised.state.variants, [{ variantId: 'crimson-medium', productId: 'shirt' }]);
});

test('observed items without a decision stay pending and are never matched by similar names', () => {
  const lookalike = {
    channel: 'b', variantId: 'b-17', productId: 'shirt', name: '衬衫',
    tone: 'red', dimension: 'M', mappingVersion: 1, observedAt: '2026-11-16T08:00:00Z',
  };
  const renamed = item({ color: 'scarlet', size: 'medium', mappingVersion: 2, observedAt: '2026-11-16T09:00:00Z' });
  const result = observeItems(emptyCatalog(), [lookalike, renamed]);
  const view = catalogView(result.state);
  assert.equal(view.variants.length, 0);
  assert.equal(view.pending.length, 2);
  assert.deepEqual(view.pending.map((entry) => entry.variantId).sort(), ['a-red-m', 'b-17']);
});

test('mappings take effect per channel version and keep each version source fields', () => {
  const decided = applyDecisions(emptyCatalog(), [decision()]).state;
  const v2 = item({ color: 'scarlet', size: 'medium', mappingVersion: 2, observedAt: '2026-11-16T09:00:00Z' });
  const observed = observeItems(decided, [item(), v2]);
  assert.equal(observed.confirmed, 2);
  const trace = traceVariant(observed.state, 'red-medium');
  assert.equal(trace.sources.length, 2);
  const byVersion = Object.fromEntries(trace.sources.map((entry) => [entry.mappingVersion, entry]));
  assert.equal(byVersion[1].sourceFields.color, '红');
  assert.equal(byVersion[2].sourceFields.color, 'scarlet');
  assert.ok(trace.sources.every((entry) => entry.basis.decisionRevision === 2));
});

test('reprocessing old pages after later decisions never undoes manual decisions', () => {
  let state = applyDecisions(emptyCatalog(), [decision()]).state;
  state = observeItems(state, [item({ color: 'scarlet', size: 'medium', mappingVersion: 2, observedAt: '2026-11-16T09:00:00Z' })]).state;
  const before = structuredClone(state);
  state = observeItems(state, [item()]).state;
  assert.deepEqual(state.decisions, before.decisions, '采集不修改人工决定');
  assert.equal(state.decisionRevision, 2);
  const trace = traceVariant(state, 'red-medium');
  assert.equal(trace.sources.length, 2);
  assert.ok(trace.sources.every((entry) => entry.status === 'confirmed'));
  assert.equal(trace.sources.find((entry) => entry.mappingVersion === 1).sourceFields.color, '红');
  const replayed = observeItems(state, [item()]);
  assert.deepEqual(replayed.state, state, '重放同一旧页面是幂等的');
});

test('deciding after observing confirms pending entries without reprocessing', () => {
  let state = observeItems(emptyCatalog(), [item()]).state;
  assert.equal(catalogView(state).pending.length, 1);
  state = applyDecisions(state, [decision()]).state;
  const view = catalogView(state);
  assert.equal(view.pending.length, 0);
  assert.equal(view.variants[0].sources[0].basis.confirmedBy, 'operator-local');
});

test('same product does not pool inventory across variants', () => {
  let state = applyDecisions(emptyCatalog(), [
    decision(),
    decision({ variantId: 'a-blue-m', canonicalVariant: 'blue-medium', decisionRevision: 3 }),
  ]).state;
  state = observeItems(state, [
    item(),
    item({ variantId: 'a-blue-m', color: '蓝' }),
  ]).state;
  const view = catalogView(state);
  assert.equal(view.inventoryUnit, 'canonicalVariant');
  assert.deepEqual(view.products, [{ productId: 'shirt', variants: ['blue-medium', 'red-medium'] }]);
  const red = traceVariant(state, 'red-medium');
  const blue = traceVariant(state, 'blue-medium');
  assert.ok(red.sources.every((entry) => entry.variantId === 'a-red-m'));
  assert.ok(blue.sources.every((entry) => entry.variantId === 'a-blue-m'));
  assert.equal(traceVariant(state, 'unknown-variant'), null);
});

test('catalog service persists decisions and mappings across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-'));
  try {
    const path = join(directory, 'state', 'catalog.json');
    const service = new CatalogService(new CatalogRepository(path));
    await service.decide([decision()]);
    const collected = await service.collect({ records: [{ attributes: item() }], next: null });
    assert.equal(collected.confirmed, 1);
    const reopened = new CatalogService(new CatalogRepository(path));
    assert.deepEqual(await reopened.catalog(), await service.catalog());
    const trace = await reopened.trace('red-medium');
    assert.equal(trace.sources[0].sourceFields.color, '红');
    assert.equal(trace.decisions[0].decisionRevision, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
