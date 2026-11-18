import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { appendDecisions, loadDecisionLedger } from './decisions.js';

// 决策台账文件：{ "decisions": [...] }，写入只通过追加完成，
// 任何采集/重放流程都不会重写该文件。
export class DecisionRepository {
  constructor(path) { this.path = path; }

  async read() {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(value.decisions)) throw new Error('decision file has no decisions array');
      return value.decisions;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async readLedger() {
    return loadDecisionLedger(await this.read());
  }

  async append(incoming) {
    const next = appendDecisions(await this.read(), incoming);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ decisions: next.entries }, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, this.path);
    return next;
  }
}
