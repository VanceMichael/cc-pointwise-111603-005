import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from './source-client.js';
import { parsePage, channelEntryPaths } from './adapter.js';
import { CollectionService } from './service.js';
import { createServices } from './wiring.js';
import { readOperations } from './operations.js';

const fixture = (name) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8').then(JSON.parse);

const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'collection-acceptance-'));
try {
  const client = new SourceClient(source.url);
  const { records, decisions, catalogView, catalogService } = createServices(directory);
  const collection = new CollectionService(records);

  // 1. 双渠道首批采集与持久化。
  const pages = await Promise.all(
    Object.values(channelEntryPaths).map(async (path) => parsePage(await client.read(path), path)),
  );
  const incoming = pages.flatMap((page) => page.records);
  const first = await collection.ingest(incoming);
  assert.equal(first.accepted, incoming.length);
  await catalogService.recordObservation(incoming);
  const stored = await records.read();
  assert.deepEqual(stored.map((row) => row.sourceId).sort(),
    ['a:a-red-m', 'b:b-17', 'b:b-18'], 'sourceId 带渠道作用域');

  // 2. 无决策时全部待确认，业务入口不产生任何主档或变体。
  await decisions.append(await fixture('decisions.json'));
  let catalog = await catalogService.refresh();
  assert.deepEqual(catalog.pending.map((item) => item.sourceId).sort(),
    ['b:b-17', 'b:b-18'], '无人工决策的条目留待确认，不按名称猜测');
  assert.equal(catalog.variants.length, 1);
  assert.equal(catalog.products.length, 1);
  assert.equal(catalog.mappings[0].channelVersion, 1);

  // 3. 运营确认后建立主档/变体/映射；同商品不同颜色尺码是独立库存单元。
  catalog = await catalogService.applyDecisions(await fixture('decisions-followup.json'));
  assert.equal(catalog.pending.length, 0);
  assert.deepEqual(catalog.variants.map((item) => item.canonicalVariant).sort(),
    ['blue-large', 'red-medium']);
  const product = catalog.products.find((item) => item.canonicalProduct === 'shirt');
  assert.deepEqual(product.variants, ['blue-large', 'red-medium']);
  assert.deepEqual(
    catalog.mappings.filter((item) => item.canonicalVariant === 'red-medium')
      .map((item) => `${item.channel}:${item.sourceVariantId}`).sort(),
    ['a:a-red-m', 'b:b-17'], '跨渠道归并只来自人工确认');

  // 4. 物化视图重启回读一致。
  const reopened = createServices(directory);
  const reloaded = await reopened.catalogService.catalog();
  assert.deepEqual(reloaded.counts, catalog.counts, '重启后读取同一份派生目录');
  const operations = await readOperations(reopened.records, reopened.catalogService);
  assert.equal(operations.rows.length, stored.length);
  assert.equal(operations.catalog.counts.variants, 2);

  // 5. 来源升级（红/M -> scarlet/medium，mappingVersion 2）后重放旧页面。
  source.publish('updated');
  const changed = parsePage(await client.read(channelEntryPaths.a), channelEntryPaths.a);
  await new CollectionService(reopened.records).ingest(changed.records);
  await reopened.catalogService.recordObservation(changed.records);
  catalog = await reopened.catalogService.refresh();
  const remapped = catalog.mappings.find((item) => item.channel === 'a' && item.sourceVariantId === 'a-red-m');
  assert.equal(remapped.canonicalVariant, 'red-medium', '重放不撤销后来做出的人工决定');
  assert.equal(remapped.channelVersion, 2, '映射按渠道版本生效');
  assert.equal(remapped.sourceFields.color, 'scarlet');
  assert.equal(remapped.basis.decisionRevision, 2, '确认依据仍指向最新人工台账条目');

  // 6. 从规范变体反查来源字段与确认依据（含被取代的历史修订）。
  const trace = await reopened.catalogService.traceVariant('red-medium');
  assert.deepEqual(trace.variant.sources.sort(), ['a:a-red-m', 'b:b-17']);
  assert.deepEqual(
    trace.decisionHistory.map((item) => `${item.source}/${item.sourceVariantId}#${item.decisionRevision}`),
    ['a/a-red-m#1', 'a/a-red-m#2', 'b/b-17#1'],
  );
  const sourceTrace = await reopened.catalogService.traceSource('a', 'a-red-m');
  assert.equal(sourceTrace.status, 'confirmed');
  assert.equal(sourceTrace.observationHistory.length, 2, '保留各渠道版本的观察历史');
  assert.equal(sourceTrace.observationHistory[0].sourceFields.color, '红');

  // 7. 台账只追加：回退 revision 被拒绝，且拒绝不改变已持久化状态。
  await assert.rejects(
    reopened.decisions.append([{
      source: 'a', variantId: 'a-red-m', canonicalProduct: 'shirt', canonicalVariant: 'red-medium',
      decisionRevision: 1, confirmedBy: 'operator-local', confirmedAt: '2026-11-16T11:00:00Z',
    }]),
    /must be greater than 2/,
  );
  await reopened.catalogView.replace(catalog);
  assert.equal((await reopened.decisions.read()).length, 4, '失败的追加不落盘');

  // 8. 重放首批记录不重复保存（现有集合行为保持）。
  const replay = await new CollectionService(reopened.records).ingest(incoming);
  assert.equal(replay.stored, 3);

  console.log(JSON.stringify({
    persisted: stored.length,
    products: reloaded.products.length,
    variants: reloaded.variants.length,
    pendingAfterConfirm: 0,
    channelVersionAfterReprocess: 2,
    operationRows: operations.rows.length,
    status: 'ok',
  }));
} finally {
  await source.close();
  await rm(directory, { recursive: true, force: true });
}
