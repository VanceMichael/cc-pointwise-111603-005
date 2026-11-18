import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { recordKey } from './catalog.js';

// 来源观察流水：每次导入按渠道:变体号追加一条快照，只追加、不覆盖。
// records.json 保存每个来源键的最新观察（现有集合语义不变），
// 流水则保留各渠道版本的原始字段，支撑来源反查与审计；
// 流水中不包含任何人工决策，重放页面只会追加观察。
export class ObservationJournal {
  constructor(path) { this.path = path; }

  async read() {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(value.observations)) throw new Error('journal file has no observations array');
      return value.observations;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async append(records) {
    const observations = await this.read();
    for (const record of records) {
      observations.push({
        key: recordKey(record),
        sourceId: record.sourceId,
        source: record.source,
        observedAt: record.observedAt,
        label: record.label,
        fields: structuredClone(record.attributes ?? {}),
      });
    }
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ observations }, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, this.path);
    return observations;
  }

  async history(key) {
    const observations = await this.read();
    return observations
      .filter((entry) => entry.key === key)
      .map((entry) => ({
        sourceId: entry.sourceId,
        observedAt: entry.observedAt,
        label: entry.label,
        sourceFields: structuredClone(entry.fields),
      }))
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  }
}
