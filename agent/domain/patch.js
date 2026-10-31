/**
 * CODE EDITS — how the agent writes code, and the rules that bound it.
 *
 * The coder model answers with SEARCH/REPLACE blocks (the format coding assistants use, because a
 * block names the exact lines it changes and fails loudly when they are not there):
 *
 *   FILE: src/domain/x.js
 *   <<<<<<< SEARCH
 *   lines copied exactly from the file
 *   =======
 *   the new lines
 *   >>>>>>> REPLACE
 *
 * An empty SEARCH creates a file. Every block must match exactly once (a whitespace-tolerant match
 * is the only fallback), so a model that misremembers the code cannot silently damage it.
 *
 * The policy is the same one the write job of agent-chat.yml enforces again, in the shell, on the
 * final diff: never the workflows, the git metadata or the architecture tests that guard the rules
 * (the agent could otherwise relax the very checks it is judged by); a bounded number of files and
 * lines; no secret; text files only.
 *
 * Pure.
 */
import { scanSecrets } from './secrets.js';

export const PATCH_POLICY = Object.freeze({
  maxFiles: 8,
  maxLines: 400,
  forbidden: [/^\.github\//, /^\.git\//, /(^|\/)node_modules\//, /^test\/architecture\.test\.js$/, /^test\/agent\/architecture\.test\.js$/, /^LICENSE/, /^config\/labels\//, /^data\//, /^dist\//],
  allowedExt: /\.(js|mjs|cjs|json|md|css|html|txt|svg|yml|yaml)$/i,
});

const BLOCK = /(?:^|\n)(?:FILE|Fișier|Fisier|File|PATH):\s*`?([^\n`]+?)`?\s*\n(?:```[a-z]*\n)?<{7} SEARCH\n([\s\S]*?)\n?={7}\n([\s\S]*?)\n?>{7} REPLACE/g;

/**
 * @returns {{path:string, search:string, replace:string}[]}
 */
export function parseEdits(text) {
  const out = [];
  const src = `\n${String(text ?? '').replace(/\r\n?/g, '\n')}`;
  for (const m of src.matchAll(BLOCK)) {
    out.push({ path: normPath(m[1]), search: m[2], replace: m[3] });
  }
  return out;
}

export const normPath = (p) => String(p ?? '').trim().replace(/^\.\//, '').replace(/\\/g, '/');

/** Policy violations of a set of paths (empty when every path may be written). */
export function pathViolations(paths, policy = PATCH_POLICY) {
  const v = [];
  const uniq = [...new Set(paths.map(normPath))];
  if (uniq.length > policy.maxFiles) v.push(`prea multe fișiere (${uniq.length} > ${policy.maxFiles})`);
  for (const p of uniq) {
    if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) v.push(`cale nepermisă: ${p || '(goală)'}`);
    else if (policy.forbidden.some((re) => re.test(p))) v.push(`fișier protejat: ${p}`);
    else if (!policy.allowedExt.test(p)) v.push(`tip de fișier nepermis: ${p}`);
  }
  return v;
}

/** Find `search` in `text` exactly once; else once ignoring indentation. */
function locate(text, search) {
  // Exact, and aligned on whole lines (a fragment of a line is not a match: it would keep the
  // line's indentation in front of the replacement).
  const found = [];
  for (let i = text.indexOf(search); i >= 0; i = text.indexOf(search, i + 1)) {
    const end = i + search.length;
    if ((i === 0 || text[i - 1] === '\n') && (end === text.length || text[end] === '\n' || search.endsWith('\n'))) found.push(i);
  }
  if (found.length === 1) return { at: found[0], len: search.length, exact: true };
  if (found.length > 1) return { error: 'apare de mai multe ori' };
  // Whitespace-tolerant: compare trimmed lines, map back to the original span.
  const lines = text.split('\n');
  const want = search.split('\n').map((l) => l.trim());
  while (want.length && !want.at(-1)) want.pop();
  if (!want.length) return { error: 'bloc SEARCH gol' };
  const hits = [];
  for (let i = 0; i + want.length <= lines.length; i += 1) {
    let ok = true;
    for (let j = 0; j < want.length && ok; j += 1) ok = lines[i + j].trim() === want[j];
    if (ok) hits.push(i);
  }
  if (hits.length !== 1) return { error: hits.length ? 'apare de mai multe ori' : 'nu există în fișier' };
  const at = lines.slice(0, hits[0]).reduce((n, l) => n + l.length + 1, 0);
  const len = lines.slice(hits[0], hits[0] + want.length).join('\n').length;
  return { at, len, exact: false };
}

/**
 * Apply edits to files in memory.
 * @param {Map<string,string|null>} files  current contents (null = the file does not exist)
 * @returns {{ok:boolean, files:Map<string,string>, changed:string[], created:string[], errors:string[]}}
 */
export function applyEdits(files, edits) {
  const next = new Map(files);
  const errors = [];
  const changed = new Set();
  const created = new Set();
  edits.forEach((e, i) => {
    const cur = next.get(e.path);
    if (cur === undefined || cur === null) {
      if (e.search.trim()) {
        errors.push(`blocul ${i + 1} (${e.path}): fișierul nu există, iar SEARCH nu este gol`);
        return;
      }
      next.set(e.path, e.replace.endsWith('\n') ? e.replace : `${e.replace}\n`);
      created.add(e.path);
      changed.add(e.path);
      return;
    }
    if (!e.search.trim()) {
      errors.push(`blocul ${i + 1} (${e.path}): SEARCH gol pentru un fișier care există — numiți liniile de schimbat`);
      return;
    }
    const loc = locate(cur, e.search);
    if (loc.error) {
      errors.push(`blocul ${i + 1} (${e.path}): textul din SEARCH ${loc.error}`);
      return;
    }
    let replacement = e.replace;
    if (!loc.exact) {
      // The model shifted the indentation: shift the replacement by the same amount, keeping its
      // own relative indentation.
      const lead = (l) => /^[ \t]*/.exec(l)[0];
      const fileIndent = lead(cur.slice(loc.at).split('\n')[0]);
      const searchIndent = lead(e.search.split('\n').find((l) => l.trim()) ?? '');
      if (fileIndent.length > searchIndent.length) {
        const add = fileIndent.slice(0, fileIndent.length - searchIndent.length);
        replacement = e.replace.split('\n').map((l) => (l.trim() ? `${add}${l}` : l)).join('\n');
      } else if (searchIndent.length > fileIndent.length) {
        const cut = searchIndent.length - fileIndent.length;
        replacement = e.replace.split('\n').map((l) => l.slice(Math.min(cut, lead(l).length))).join('\n');
      }
    }
    next.set(e.path, `${cur.slice(0, loc.at)}${replacement}${cur.slice(loc.at + loc.len)}`);
    changed.add(e.path);
  });
  return { ok: errors.length === 0 && changed.size > 0, files: next, changed: [...changed], created: [...created], errors: changed.size || errors.length ? errors : ['niciun bloc de editare în răspunsul modelului'] };
}

/** Lines added and removed between two versions of a file (a cheap LCS-free estimate by line sets). */
export function lineDelta(before, after) {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');
  const count = (arr) => arr.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  let added = 0;
  let removed = 0;
  for (const [l, n] of cb) added += Math.max(0, n - (ca.get(l) ?? 0));
  for (const [l, n] of ca) removed += Math.max(0, n - (cb.get(l) ?? 0));
  return { added, removed };
}

/**
 * The whole check of a proposed change: paths, size, secrets.
 * @param {Map<string,string|null>} before
 * @param {Map<string,string>} after
 * @param {string[]} changed
 */
export function validateChange(before, after, changed, policy = PATCH_POLICY) {
  const problems = pathViolations(changed, policy);
  let lines = 0;
  for (const p of changed) {
    const d = lineDelta(before.get(p) ?? '', after.get(p) ?? '');
    lines += d.added + d.removed;
  }
  if (lines > policy.maxLines) problems.push(`schimbare prea mare (${lines} linii > ${policy.maxLines})`);
  const leaks = scanSecrets(changed.map((p) => ({ name: p, text: after.get(p) ?? '' }))).leaks;
  for (const l of leaks) problems.push(`tipar de cheie (${l.pattern}) în ${l.file}`);
  return { ok: problems.length === 0, problems, lines };
}
