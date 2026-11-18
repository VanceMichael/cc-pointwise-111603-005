import { buildCatalog, traceSource, traceVariant } from './catalog.js';
import { sourceKey } from './decisions.js';

// 目录采集服务：观察（RecordRepository + ObservationJournal）与决策
// （DecisionRepository）各自独立，采集重放只影响观察；
// 人工决定只通过 applyDecisions 追加，重放任何页面都无法撤销。
export class CatalogService {
  constructor(records, decisions, catalogView = null, journal = null) {
    this.records = records;
    this.decisions = decisions;
    this.catalogView = catalogView;
    this.journal = journal;
  }

  async recordObservation(incoming) {
    if (this.journal) await this.journal.append(incoming);
  }

  async derive() {
    const [recordList, ledger] = await Promise.all([
      this.records.read(),
      this.decisions.readLedger(),
    ]);
    return buildCatalog(recordList, ledger);
  }

  async refresh() {
    const catalog = await this.derive();
    if (this.catalogView) await this.catalogView.replace(catalog);
    return catalog;
  }

  async applyDecisions(incoming) {
    const ledger = await this.decisions.append(incoming);
    return this.refresh();
  }

  async catalog() {
    if (this.catalogView) {
      const stored = await this.catalogView.read();
      if (stored) return stored;
    }
    return this.derive();
  }

  async pending() {
    return (await this.catalog()).pending;
  }

  async traceVariant(canonicalVariantId) {
    const [catalog, ledger] = await Promise.all([this.catalog(), this.decisions.readLedger()]);
    const trace = traceVariant(catalog, ledger, canonicalVariantId);
    if (trace && this.journal) {
      trace.mappings = await Promise.all(trace.mappings.map(async (mapping) => ({
        ...mapping,
        observationHistory: await this.journal.history(sourceKey(mapping.channel, mapping.sourceVariantId)),
      })));
    }
    return trace;
  }

  async traceSource(channel, sourceVariantId) {
    const key = sourceKey(channel, sourceVariantId);
    const [catalog, ledger, recordList] = await Promise.all([
      this.catalog(),
      this.decisions.readLedger(),
      this.records.read(),
    ]);
    const trace = traceSource(catalog, ledger, recordList, channel, sourceVariantId);
    if (!trace) return null;
    if (this.journal) {
      trace.observationHistory = await this.journal.history(key);
    }
    return trace;
  }
}
