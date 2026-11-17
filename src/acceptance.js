import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from './source-client.js';
import { parsePage, entryPath } from './adapter.js';
import { RecordRepository } from './repository.js';
import { CollectionService } from './service.js';
import { CatalogRepository } from './catalog-repository.js';
import { CatalogService } from './catalog-service.js';
import { readOperations } from './operations.js';

const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'collection-acceptance-'));
try {
  const page = parsePage(await new SourceClient(source.url).read(entryPath));
  assert.ok(page.records.length > 0, '初始来源须有可接收的业务记录');
  const path = join(directory, 'records.json');
  const repository = new RecordRepository(path);
  const first = await new CollectionService(repository).ingest(page.records);
  assert.equal(first.accepted, page.records.length);
  const stored = await repository.read();
  const reopened = new RecordRepository(path);
  assert.deepEqual(await new CollectionService(reopened).query({}), stored, '重新打开后读取同一份业务记录');
  const second = await new CollectionService(reopened).ingest(page.records);
  assert.equal(second.stored, stored.length, '重放首批记录不重复保存');
  const operations = await readOperations(reopened);
  assert.deepEqual(operations.rows.map(row => row.sourceId), stored.map(row => row.sourceId));
  for (const row of operations.rows) {
    const original = stored.find(record => record.sourceId === row.sourceId);
    assert.equal(row.source, original.source);
    assert.equal(row.observedAt, original.observedAt);
    for (const [field, value] of Object.entries(row.attributes)) assert.deepEqual(value, original.attributes[field] ?? null);
  }

  const client = new SourceClient(source.url);
  const catalogPath = join(directory, 'catalog.json');
  const catalog = new CatalogService(new CatalogRepository(catalogPath), new CollectionService(reopened));
  const decisions = JSON.parse(await readFile(new URL('../fixtures/decisions.json', import.meta.url), 'utf8'));
  const decided = await catalog.decide(decisions);
  assert.equal(decided.applied, 3, '三份人工决定全部生效');
  assert.equal(decided.decisionRevision, 4, '决定版本取最高 revision');
  const again = await catalog.decide(decisions);
  assert.equal(again.applied, 0, '重复应用同一份决定是幂等的');
  assert.equal(again.decisionRevision, 4, '决定版本不被同 revision 回退');

  await catalog.collect(parsePage(await client.read(entryPath)));
  await catalog.collect(parsePage(await client.read('/catalog/channel-b')));
  let view = await catalog.catalog();
  assert.deepEqual(view.pending.map(entry => `${entry.channel}/${entry.variantId}`), ['b/b-18'],
    '无人工决定的条目保持待确认，不按名称或属性相似度猜测归并');
  let redMedium = view.variants.find(variant => variant.variantId === 'red-medium');
  assert.equal(redMedium.sources.length, 2, 'red-medium 汇聚两个已确认来源');

  source.publish('updated');
  await catalog.collect(parsePage(await client.read(entryPath)));
  let trace = await catalog.trace('red-medium');
  const v1 = trace.sources.find(entry => entry.channel === 'a' && entry.mappingVersion === 1);
  const v2 = trace.sources.find(entry => entry.channel === 'a' && entry.mappingVersion === 2);
  assert.equal(v1.sourceFields.color, '红', '渠道映射升级后旧版本来源字段保持原样');
  assert.equal(v2.sourceFields.color, 'scarlet', '新版本映射按渠道版本独立生效');
  assert.equal(v1.basis.decisionRevision, 2, '确认依据可反查');
  assert.equal(v1.basis.confirmedBy, 'operator-local');

  source.publish('opening');
  await catalog.collect(parsePage(await client.read(entryPath)));
  view = await catalog.catalog();
  assert.equal(view.decisionRevision, 4, '重放旧页面不撤销后来做出的人工决定');
  assert.deepEqual(view.pending.map(entry => `${entry.channel}/${entry.variantId}`), ['b/b-18'],
    '重放旧页面不产生新的猜测归并');
  trace = await catalog.trace('red-medium');
  assert.equal(trace.sources.length, 3, '旧版本映射在重放后仍然保留');
  assert.ok(trace.sources.every(entry => entry.status === 'confirmed' && entry.basis.confirmedBy === 'operator-local'));
  assert.equal(trace.sources.find(entry => entry.channel === 'a' && entry.mappingVersion === 1).sourceFields.color, '红');
  assert.equal(trace.decisions.length, 2, '反查给出该变体的全部人工决定');

  const blueMedium = await catalog.trace('blue-medium');
  assert.equal(blueMedium.variant.productId, 'shirt', '两个变体属于同一商品主档');
  assert.ok(blueMedium.sources.every(entry => entry.variantId === 'a-blue-m'), '相同商品的不同变体不混用来源');
  assert.ok(trace.sources.every(entry => entry.variantId !== 'a-blue-m'), '库存以变体为单位隔离');

  const restarted = new CatalogService(new CatalogRepository(catalogPath));
  assert.deepEqual(await restarted.catalog(), view, '目录状态重启后回读一致');
  const withCatalog = await readOperations(reopened, new CatalogRepository(catalogPath));
  assert.equal(withCatalog.catalog.decisionRevision, 4, '业务读取入口看到一致的目录状态');
  assert.equal(withCatalog.catalog.inventoryUnit, 'canonicalVariant');

  console.log(JSON.stringify({
    accepted: first.accepted,
    persisted: stored.length,
    replayStored: second.stored,
    operationRows: operations.rows.length,
    decisionRevision: view.decisionRevision,
    variants: view.variants.length,
    pending: view.pending.length,
    status: 'ok',
  }));
} finally {
  await source.close();
  await rm(directory, {recursive: true, force: true});
}
