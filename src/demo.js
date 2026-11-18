import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from './source-client.js';
import { parsePage, channelEntryPaths } from './adapter.js';
import { CollectionService } from './service.js';
import { createServices } from './wiring.js';
import { readOperations } from './operations.js';

const here = new URL('.', import.meta.url);
const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'collection-demo-'));
try {
  const client = new SourceClient(source.url);
  const { records, decisions, catalogService } = createServices(directory);
  const collection = new CollectionService(records);

  // 1. 首批采集：A、B 两个渠道页面全部导入。
  const pages = await Promise.all(
    Object.values(channelEntryPaths).map(async (path) => parsePage(await client.read(path), path)),
  );
  await collection.ingest(pages.flatMap((page) => page.records));
  await catalogService.recordObservation(pages.flatMap((page) => page.records));

  // 2. 载入既有人工确认台账（只追加，采集流程不会重写它）。
  const openingDecisions = JSON.parse(
    await readFile(new URL('../fixtures/decisions.json', here), 'utf8'),
  );
  await decisions.append(openingDecisions);
  let catalog = await catalogService.refresh();
  console.log('首批目录:', JSON.stringify(catalog.counts));
  console.log('待确认（无人工决策，禁止按名称猜测）:',
    JSON.stringify(catalog.pending.map((item) => item.sourceId)));

  // 3. 运营依据实物吊牌补齐 B 渠道确认。
  const followup = JSON.parse(await readFile(new URL('../fixtures/decisions-followup.json', here), 'utf8'));
  catalog = await catalogService.applyDecisions(followup);
  console.log('确认后目录:', JSON.stringify(catalog.counts));
  console.log('可售变体（颜色尺码不同即独立库存单元）:',
    JSON.stringify(catalog.variants.map((item) => `${item.canonicalProduct}/${item.canonicalVariant}`)));

  // 4. 渠道 A 发布新版本（红/M 写成 scarlet/medium，mappingVersion 2），重放旧页面。
  source.publish('updated');
  const changedPage = parsePage(await client.read(channelEntryPaths.a), channelEntryPaths.a);
  await collection.ingest(changedPage.records);
  await catalogService.recordObservation(changedPage.records);
  catalog = await catalogService.refresh();
  const remapped = catalog.mappings.find((item) => item.channel === 'a');
  console.log('重放后 A 渠道映射:', JSON.stringify({
    sourceVariantId: remapped.sourceVariantId,
    channelVersion: remapped.channelVersion,
    canonicalVariant: remapped.canonicalVariant,
    decisionRevision: remapped.basis.decisionRevision,
    observedColor: remapped.sourceFields.color,
  }));

  // 5. 从规范变体反查来源字段与确认依据。
  const trace = await catalogService.traceVariant('red-medium');
  console.log('red-medium 反查:', JSON.stringify({
    sources: trace.variant.sources,
    decisionHistory: trace.decisionHistory.map((item) => `${item.source}/${item.sourceVariantId}#${item.decisionRevision}`),
  }, null, 2));

  console.log(JSON.stringify(await readOperations(records, catalogService).then((view) => ({
    rows: view.rows.length,
    catalog: view.catalog.counts,
  }))));
} finally {
  await source.close();
  await rm(directory, { recursive: true, force: true });
}
