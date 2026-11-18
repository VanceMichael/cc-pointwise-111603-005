import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// 派生目录的物化视图：可以随时由观察集合 + 决策台账重新计算，
// 持久化仅用于重启后得到一致的读取状态。
export class CatalogRepository {
  constructor(path) { this.path = path; }

  async read() {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      if (!value.catalog || !Array.isArray(value.catalog.products)) {
        throw new Error('catalog file has no catalog object');
      }
      return value.catalog;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async replace(catalog) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ catalog }, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, this.path);
  }
}
