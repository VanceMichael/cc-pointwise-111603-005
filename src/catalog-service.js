import { applyDecisions, catalogView, observeItems, traceVariant } from './catalog.js';

export class CatalogService {
  constructor(catalogRepository, recordService = null) {
    this.catalogRepository = catalogRepository;
    this.recordService = recordService;
  }

  async collect(page) {
    const ingested = this.recordService ? await this.recordService.ingest(page.records) : {};
    const items = page.records.map((record) => record.attributes ?? record);
    const current = await this.catalogRepository.read();
    const observed = observeItems(current, items);
    await this.catalogRepository.replace(observed.state);
    return { ...ingested, observed: observed.observed, confirmed: observed.confirmed, pending: observed.pending };
  }

  async decide(decisions) {
    const current = await this.catalogRepository.read();
    const result = applyDecisions(current, decisions);
    await this.catalogRepository.replace(result.state);
    return { applied: result.applied, skipped: result.skipped, decisionRevision: result.state.decisionRevision };
  }

  async catalog() { return catalogView(await this.catalogRepository.read()); }

  async trace(canonicalVariant) { return traceVariant(await this.catalogRepository.read(), canonicalVariant); }
}
