/**
 * ConversationsPort over a directory: one JSON file per conversation (`<dir>/<id>.json`), written
 * atomically, so the history survives a crash and is easy to back up, sync (git, Termux) or delete by
 * hand. Local files only.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LIMITS, isValidId, sortSummaries, summaryOf } from '../domain/conversations.js';

const valid = (c) => c && typeof c === 'object' && isValidId(c.id) && Array.isArray(c.messages) && typeof c.title === 'string';

export function createConversationsFs({ dir }) {
  const path = (id) => join(dir, `${id}.json`);
  const read = async (id) => {
    try {
      const c = JSON.parse(await readFile(path(id), 'utf8'));
      return valid(c) && c.id === id ? c : null;
    } catch {
      return null;
    }
  };
  return {
    async all() {
      let names = [];
      try {
        names = (await readdir(dir)).filter((f) => f.endsWith('.json') && isValidId(f.slice(0, -5)));
      } catch {
        return [];
      }
      const items = (await Promise.all(names.map((f) => read(f.slice(0, -5))))).filter(Boolean);
      return items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, LIMITS.conversations);
    },
    get: (id) => (isValidId(id) ? read(id) : Promise.resolve(null)),
    /** `<dir>/../index.json`: the list the dashboard reads with one request instead of one per conversation. */
    async reindex() {
      const all = await this.all();
      const target = join(dirname(dir), 'index.json');
      await mkdir(dirname(target), { recursive: true });
      const tmp = `${target}.tmp`;
      await writeFile(tmp, JSON.stringify({ version: 1, conversations: sortSummaries(all.map(summaryOf)) }));
      await rename(tmp, target);
    },
    async save(conversation) {
      if (!valid(conversation)) throw new Error('conversație invalidă');
      await mkdir(dir, { recursive: true });
      const tmp = `${path(conversation.id)}.tmp`;
      await writeFile(tmp, JSON.stringify(conversation));
      await rename(tmp, path(conversation.id));
    },
    async remove(id) {
      if (isValidId(id)) await rm(path(id), { force: true });
    },
  };
}
