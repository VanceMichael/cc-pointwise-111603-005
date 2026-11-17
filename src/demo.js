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
const directory = await mkdtemp(join(tmpdir(), 'collection-demo-'));
try {
  const client = new SourceClient(source.url);
  const recordRepository = new RecordRepository(join(directory, 'records.json'));
  const catalogRepository = new CatalogRepository(join(directory, 'catalog.json'));
  const catalog = new CatalogService(catalogRepository, new CollectionService(recordRepository));
  const decisions = JSON.parse(await readFile(new URL('../fixtures/decisions.json', import.meta.url), 'utf8'));
  const decided = await catalog.decide(decisions);
  const openingA = await catalog.collect(parsePage(await client.read(entryPath)));
  const openingB = await catalog.collect(parsePage(await client.read('/catalog/channel-b')));
  source.publish('updated');
  const upgradedA = await catalog.collect(parsePage(await client.read(entryPath)));
  source.publish('opening');
  const replayedA = await catalog.collect(parsePage(await client.read(entryPath)));
  const operations = await readOperations(recordRepository, catalogRepository);
  const trace = await catalog.trace('red-medium');
  console.log(JSON.stringify({
    decided,
    collected: { openingA, openingB, upgradedA, replayedA },
    operations,
    trace,
  }, null, 2));
} finally { await source.close(); await rm(directory, { recursive: true, force: true }); }
