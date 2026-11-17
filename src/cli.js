import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { RecordRepository } from './repository.js';
import { CollectionService } from './service.js';
import { CatalogRepository } from './catalog-repository.js';
import { CatalogService } from './catalog-service.js';
import { parsePage } from './adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = process.env.STATE_DIR ?? resolve(here, '../var');
const recordService = new CollectionService(new RecordRepository(resolve(stateDir, 'records.json')));
const catalogService = new CatalogService(new CatalogRepository(resolve(stateDir, 'catalog.json')), recordService);
const commands = ['ingest', 'query', 'collect', 'decide', 'catalog', 'trace'];
const action = process.argv[2] ?? '--help';
if (action === '--help' || action === '-h') {
  console.log(JSON.stringify({
    usage: 'npm start -- ingest [文件] | query [来源] | collect <文件> | decide [文件] | catalog | trace <变体>',
    commands,
  }));
  process.exit(0);
}
if (action === 'ingest') {
  const records = JSON.parse(await readFile(process.argv[3] ?? resolve(here, '../fixtures/records.json'), 'utf8'));
  console.log(JSON.stringify(await recordService.ingest(records), null, 2));
} else if (action === 'query') {
  console.log(JSON.stringify(await recordService.query({ source: process.argv[3] }), null, 2));
} else if (action === 'collect') {
  if (!process.argv[3]) throw new Error('collect requires a page or records file');
  const text = await readFile(process.argv[3], 'utf8');
  const page = Array.isArray(JSON.parse(text)) ? { records: JSON.parse(text), next: null } : parsePage({ text });
  console.log(JSON.stringify(await catalogService.collect(page), null, 2));
} else if (action === 'decide') {
  const decisions = JSON.parse(await readFile(process.argv[3] ?? resolve(here, '../fixtures/decisions.json'), 'utf8'));
  console.log(JSON.stringify(await catalogService.decide(decisions), null, 2));
} else if (action === 'catalog') {
  console.log(JSON.stringify(await catalogService.catalog(), null, 2));
} else if (action === 'trace') {
  if (!process.argv[3]) throw new Error('trace requires a canonical variant');
  const traced = await catalogService.trace(process.argv[3]);
  if (!traced) throw new Error(`unknown canonical variant: ${process.argv[3]}`);
  console.log(JSON.stringify(traced, null, 2));
} else {
  throw new Error(`action must be one of: ${commands.join(', ')}`);
}
