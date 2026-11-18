import { join } from 'node:path';
import { RecordRepository } from './repository.js';
import { DecisionRepository } from './catalog/decision-repository.js';
import { CatalogRepository } from './catalog/catalog-repository.js';
import { CatalogService } from './catalog/catalog-service.js';
import { ObservationJournal } from './catalog/observation-journal.js';

// 状态目录布局：
//  records.json       原始来源观察的最新集合（现有集合，采集/重放写入）
//  observations.json  只追加的来源观察流水（保留各渠道版本的原始字段）
//  decisions.json     人工确认台账（只追加，采集流程不触碰）
//  catalog.json       派生目录物化视图（可随时重建）
export function createServices(stateDir) {
  const records = new RecordRepository(join(stateDir, 'records.json'));
  const journal = new ObservationJournal(join(stateDir, 'observations.json'));
  const decisions = new DecisionRepository(join(stateDir, 'decisions.json'));
  const catalogView = new CatalogRepository(join(stateDir, 'catalog.json'));
  const catalogService = new CatalogService(records, decisions, catalogView, journal);
  return { records, journal, decisions, catalogView, catalogService };
}
