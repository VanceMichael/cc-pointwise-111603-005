import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyCatalog } from './catalog.js';

export class CatalogRepository {
  constructor(path) { this.path = path; }

  async read() {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Number.isInteger(value.decisionRevision)) throw new Error('catalog file has no decisionRevision');
      for (const key of ['decisions', 'products', 'variants', 'mappings']) {
        if (!Array.isArray(value[key])) throw new Error(`catalog file has no ${key} array`);
      }
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return emptyCatalog();
      throw error;
    }
  }

  async replace(state) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, this.path);
  }
}
