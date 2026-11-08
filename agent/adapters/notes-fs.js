/** The assistant's few named text files (owner.md, lessons.md, lessons-proposed.md) in the memory directory. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const NAMES = new Set(['owner.md', 'lessons.md', 'lessons-proposed.md']);

export function createNotesFs({ dir }) {
  const path = (name) => {
    if (!NAMES.has(name)) throw new Error(`notă necunoscută: ${name}`);
    return join(dir, name);
  };
  return {
    async get(name) {
      try {
        return await readFile(path(name), 'utf8');
      } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
    },
    async put(name, text) {
      await mkdir(dir, { recursive: true });
      const tmp = `${path(name)}.tmp`;
      await writeFile(tmp, String(text ?? '').slice(0, 20_000));
      await rename(tmp, path(name));
    },
  };
}
