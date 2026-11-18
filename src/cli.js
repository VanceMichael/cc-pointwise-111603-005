import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { RecordRepository } from './repository.js';
import { CollectionService } from './service.js';
import { createServices } from './wiring.js';
import { readOperations } from './operations.js';

const here = dirname(fileURLToPath(import.meta.url));
const defaultStateDir = resolve(here, '../var');
const defaultFixtures = resolve(here, '../fixtures/records.json');

function stateDirFromArgs() {
  const flag = process.argv.indexOf('--state-dir');
  if (flag === -1 || !process.argv[flag + 1]) return defaultStateDir;
  return resolve(process.argv[flag + 1]);
}

function restArgs() {
  const args = process.argv.slice(3).filter((value) => !value.startsWith('--state-dir'));
  return args;
}

async function readJsonArray(path, label) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array`);
  return value;
}

const action = process.argv[2] ?? '--help';
if (action === '--help' || action === '-h') {
  console.log(JSON.stringify({
    usage: 'npm start -- <命令> [参数] [--state-dir 目录]',
    commands: ['ingest', 'query', 'decide', 'catalog', 'pending', 'trace'],
    details: {
      ingest: 'ingest [文件] 导入来源观察（默认 fixtures/records.json）',
      query: 'query [来源] 读取原始观察集合',
      decide: 'decide <决策文件> 追加人工确认（decisionRevision 必须递增）',
      catalog: 'catalog 查看商品主档、可售变体与来源映射',
      pending: 'pending 查看无法可靠对应、待人工确认的来源条目',
      trace: 'trace <规范变体ID> 反查来源字段、观察历史与确认依据',
    },
  }, null, 2));
  process.exit(0);
}

const stateDir = stateDirFromArgs();
const { records, catalogService } = createServices(stateDir);

if (action === 'ingest') {
  const [file = defaultFixtures] = restArgs();
  const inputs = await readJsonArray(file, 'ingest input');
  const result = await new CollectionService(records).ingest(inputs);
  await catalogService.recordObservation(inputs);
  const catalog = await catalogService.refresh();
  console.log(JSON.stringify({ ...result, catalog: catalog.counts, pending: catalog.pending.length }, null, 2));
} else if (action === 'query') {
  const [source] = restArgs();
  console.log(JSON.stringify(await new CollectionService(records).query({ source }), null, 2));
} else if (action === 'decide') {
  const [file] = restArgs();
  if (!file) throw new Error('decide requires a decision file');
  const incoming = await readJsonArray(file, 'decision input');
  const catalog = await catalogService.applyDecisions(incoming);
  console.log(JSON.stringify({ applied: incoming.length, catalog: catalog.counts }, null, 2));
} else if (action === 'catalog') {
  console.log(JSON.stringify(await catalogService.catalog(), null, 2));
} else if (action === 'pending') {
  console.log(JSON.stringify(await catalogService.pending(), null, 2));
} else if (action === 'trace') {
  const [canonicalVariantId] = restArgs();
  if (!canonicalVariantId) throw new Error('trace requires a canonical variant id');
  const result = await catalogService.traceVariant(canonicalVariantId);
  if (!result) throw new Error(`unknown canonical variant: ${canonicalVariantId}`);
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error('action must be ingest, query, decide, catalog, pending or trace');
}
