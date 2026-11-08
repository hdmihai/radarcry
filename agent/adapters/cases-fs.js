/** The solved cases: one JSON file each in `<dir>/<id>.json`, newest first when listed. */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ID = /^c[a-z0-9]{4,16}-[a-z0-9]{1,8}$/;
export const isCaseId = (id) => typeof id === 'string' && ID.test(id);

export function createCasesFs({ dir, cap = 400 }) {
  const read = async (id) => {
    try {
      const c = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8'));
      return c && c.id === id && typeof c.request === 'string' ? c : null;
    } catch {
      return null;
    }
  };
  return {
    async all() {
      let names = [];
      try {
        names = (await readdir(dir)).filter((f) => f.endsWith('.json') && isCaseId(f.slice(0, -5)));
      } catch {
        return [];
      }
      const items = (await Promise.all(names.map((f) => read(f.slice(0, -5))))).filter(Boolean);
      return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, cap);
    },
    get: (id) => (isCaseId(id) ? read(id) : Promise.resolve(null)),
    async save(c) {
      if (!isCaseId(c?.id)) throw new Error('caz invalid');
      await mkdir(dir, { recursive: true });
      const tmp = join(dir, `${c.id}.json.tmp`);
      await writeFile(tmp, JSON.stringify(c));
      await rename(tmp, join(dir, `${c.id}.json`));
    },
  };
}
