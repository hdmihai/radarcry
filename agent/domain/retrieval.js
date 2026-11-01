/**
 * RETRIEVAL — the passages of the project's own documentation (and the files of its code) that
 * answer a question, found by keyword relevance (BM25), with Romanian diacritics folded and a light
 * stemmer. No embeddings and no service: it runs anywhere Node runs, Termux included, and every
 * answer can quote its source.
 *
 * Pure.
 */
import { fold } from './commands.js';

const STOP = new Set(['si', 'sau', 'ca', 'cu', 'de', 'la', 'in', 'din', 'pe', 'pentru', 'care', 'este', 'sunt', 'un', 'una', 'unei', 'unui', 'ale', 'al', 'cel', 'cea', 'cei', 'cele', 'nu', 'mai', 'cum', 'ce', 'cat', 'cate', 'fie', 'iar', 'dar', 'daca', 'prin', 'spre', 'sa', 'se', 'ne', 'va', 'vor', 'are', 'au', 'fost', 'fi', 'pot', 'poate', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'not', 'into']);

/**
 * A light Romanian/English stemmer: inflection suffixes off, then the word cut to its first seven
 * letters (truncation stemming), so „prognozei” meets „prognoza”, „interacționez” meets
 * „interacțiune” and „identifică” meets „identificarea”.
 */
export function stem(w) {
  let t = w;
  for (const suf of ['urilor', 'ilor', 'elor', 'ului', 'iile', 'urile', 'lor', 'ele', 'ile', 'ul', 'le', 'ii', 'ea', 'ing', 'es', 's']) {
    if (t.length - suf.length >= 4 && t.endsWith(suf)) {
      t = t.slice(0, -suf.length);
      break;
    }
  }
  while (t.length > 4 && /[aeiuo]$/.test(t)) t = t.slice(0, -1);
  return t.slice(0, 7);
}

/** Tokens of a text: folded, split on non-letters and camelCase, stop words out, stemmed. */
export function tokens(text) {
  const spaced = String(text ?? '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return fold(spaced)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem);
}

/**
 * Split Markdown documents into sections (one per heading, long sections in pieces).
 * @param {{name:string, text:string}[]} docs
 */
/**
 * A paragraph too long for one passage: its list items or table rows whole; a wrapped prose
 * paragraph by sentences; anything else (a code block, a diagram) by lines.
 */
function piecesOf(para) {
  const lines = para.split('\n');
  const item = /^\s*(?:[-*+]|\d+\.|\|)\s?/;
  if (lines.some((l) => item.test(l))) {
    const items = [];
    for (const l of lines) {
      if (item.test(l) || !items.length) items.push(l);
      else items[items.length - 1] += `\n${l}`;
    }
    return [items, '\n'];
  }
  const prose = lines.every((l, i) => (l.length >= 50 || i === lines.length - 1) && !/^\s/.test(l) && !/[│┌└─┐┘├┤]/.test(l));
  if (prose) return [para.replace(/\n/g, ' ').split(/(?<=[.!?…])\s+(?=[\p{Lu}„(0-9*`])/u), ' '];
  return [lines, '\n'];
}

export function chunkDocs(docs, { maxChars = 1800 } = {}) {
  const out = [];
  for (const d of docs ?? []) {
    const lines = String(d.text ?? '').split('\n');
    let heading = d.name;
    let trail = [];
    let buf = [];
    let inCode = false;
    const flush = () => {
      const text = buf.join('\n').trim();
      // Whole paragraphs up to maxChars (a long one by lines, a huge line at word boundaries), so a
      // passage quoted to the owner starts where a thought starts, never in the middle of a word.
      let cur = '';
      const push = () => {
        if (cur.trim()) out.push({ doc: d.name, heading, path: trail.join(' › '), text: cur.trim() });
        cur = '';
      };
      for (const para of text ? text.split(/\n{2,}/) : []) {
        const [pieces, join] = para.length <= maxChars ? [[para], '\n'] : piecesOf(para);
        let sep = '\n\n';
        for (const piece of pieces) {
          const parts = piece.length <= maxChars ? [piece] : piece.match(new RegExp(`\\S[\\s\\S]{0,${maxChars - 2}}(?=\\s|$)`, 'g')) ?? [piece.slice(0, maxChars)];
          for (const part of parts) {
            if (cur && cur.length + part.length + 2 > maxChars) push();
            cur = cur ? `${cur}${sep}${part}` : part;
            sep = join;
          }
        }
      }
      push();
      buf = [];
    };
    for (const line of lines) {
      if (/^```/.test(line)) inCode = !inCode;
      const h = !inCode && /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
      if (h) {
        flush();
        const level = h[1].length;
        trail = [...trail.slice(0, level - 1), h[2]];
        heading = h[2];
        continue;
      }
      buf.push(line);
    }
    flush();
  }
  return out;
}

/**
 * The k most relevant items for a query (BM25; a word of the heading or path counts three times).
 * @template {{text:string, heading?:string, path?:string}} T
 * @param {T[]} items
 * @returns {(T & {score:number})[]}
 */
export function search(items, query, { k = 4, k1 = 1.2, b = 0.75, minScore = 0.5 } = {}) {
  const q = [...new Set(tokens(query))];
  if (!q.length || !items?.length) return [];
  const docs = items.map((it) => {
    const body = tokens(it.text);
    const head = tokens(`${it.heading ?? ''} ${it.path ?? ''}`);
    const tf = new Map();
    for (const t of body) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of head) tf.set(t, (tf.get(t) ?? 0) + 3);
    return { it, tf, len: body.length + head.length * 3 };
  });
  const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length || 1;
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.tf.has(t)).length]));
  const N = docs.length;
  const scored = docs.map((d) => {
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.len) / avg));
    }
    return { ...d.it, score: Math.round(s * 1000) / 1000 };
  });
  return scored.filter((x) => x.score >= minScore).sort((a, b2) => b2.score - a.score).slice(0, k);
}

/**
 * The code files most relevant to a task, by path and content, with their paired tests.
 * @param {{path:string, text:string}[]} files
 */
export function rankFiles(files, task, { k = 4 } = {}) {
  const items = (files ?? []).map((f) => ({ ...f, heading: f.path.replace(/[/._-]+/g, ' '), text: f.text.slice(0, 40_000) }));
  const top = search(items, task, { k: k * 2, minScore: 0.2 });
  const out = [];
  for (const f of top) {
    if (out.some((x) => x.path === f.path)) continue;
    out.push(f);
    // A source file brings its test (src/domain/x.js → test/domain/x.test.js), when it exists.
    const testPath = f.path.replace(/^(src|agent)\/(.+)\.js$/, (m, root, rest) => (root === 'agent' ? `test/agent/${rest.split('/').pop()}.test.js` : `test/${rest}.test.js`));
    const t = testPath !== f.path ? files.find((x) => x.path === testPath) : null;
    if (t && !out.some((x) => x.path === t.path)) out.push({ ...t, score: f.score / 2 });
    if (out.length >= k) break;
  }
  return out.slice(0, k);
}

/**
 * A long file cut to the windows around the lines that match the task, so the model sees exact
 * lines it can copy into a SEARCH block (every kept line is verbatim; cuts are marked).
 */
export function excerpt(text, task, { maxChars = 9000, radius = 40 } = {}) {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  const lines = s.split('\n');
  const q = new Set(tokens(task));
  const hits = [];
  lines.forEach((l, i) => {
    const n = tokens(l).filter((t) => q.has(t)).length;
    if (n) hits.push([i, n]);
  });
  hits.sort((a, b) => b[1] - a[1]);
  const keep = new Set();
  for (const [i] of hits) {
    for (let j = Math.max(0, i - radius); j <= Math.min(lines.length - 1, i + radius); j += 1) keep.add(j);
    if ([...keep].reduce((n, j) => n + lines[j].length + 1, 0) > maxChars) break;
  }
  if (!keep.size) for (let j = 0; j < Math.min(lines.length, 200); j += 1) keep.add(j);
  const out = [];
  let prev = -2;
  for (const j of [...keep].sort((a, b) => a - b)) {
    if (j !== prev + 1) out.push('… (linii omise) …');
    out.push(lines[j]);
    prev = j;
  }
  if (prev < lines.length - 1) out.push('… (linii omise) …');
  return out.join('\n').slice(0, maxChars + 2000);
}
