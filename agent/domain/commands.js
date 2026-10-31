/**
 * CHAT COMMANDS — what the owner can ask the agent, free, from a GitHub issue comment (`/agent …`),
 * from the terminal (`npm run agent:chat -- …`, Termux included) or from the dashboard's link.
 *
 * Pure: a text in, a command out. Diacritics are optional (`diagnoză` = `diagnoza`), so a phone
 * keyboard never gets in the way.
 */

/** Romanian diacritics folded, lower case — the form commands and search tokens are matched in. */
export const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[șş]/g, 's')
    .replace(/[țţ]/g, 't')
    .toLowerCase();

export const COMMANDS = Object.freeze([
  { id: 'help', words: ['ajutor', 'help', 'comenzi', '?'], usage: 'ajutor', what: 'lista comenzilor', llm: false },
  { id: 'status', words: ['stare', 'status', 'rezumat'], usage: 'stare', what: 'starea generală, ce cere atenție, eficiența și ce a învățat agentul', llm: false },
  { id: 'gates', words: ['porti', 'gates', 'poarta'], usage: 'porți [grup | id]', what: 'porțile de calitate, întâi cele care nu trec (grupuri: cod, rulare, cadenta, periodic, model, agent)', llm: false },
  { id: 'diagnose', words: ['diagnoza', 'diagnostic', 'diagnose', 'de ce'], usage: 'diagnoză [id-poartă | run <id> | url rulare]', what: 'cauza unei porți eșuate sau a unei rulări: pașii căzuți, adnotările, semnătura, commiturile suspecte și remedierea care a mers data trecută', llm: false },
  { id: 'efficiency', words: ['eficienta', 'identificare', 'efficiency'], usage: 'eficiență', what: 'cât de des ating proiectele semnalate +20% în 72 h față de univers, pe niveluri (lift, intervale, recall)', llm: false },
  { id: 'forecast', words: ['prognoza', 'forecast'], usage: 'prognoză SIMBOL', what: 'probabilitatea ≥100× / ≥20× în 12 luni a unui proiect și din ce se formează', llm: false },
  { id: 'rules', words: ['reguli', 'rules', 'criterii'], usage: 'reguli [id]', what: 'regulile fundamentale de evaluare și monitorizare, cu verdictul fiecăreia', llm: false },
  { id: 'learning', words: ['invatare', 'autoevaluare', 'auto-evaluare', 'learning'], usage: 'învățare', what: 'auto-evaluarea: cât de bine anticipează agentul, curba de învățare, normele, lecțiile, propunerile de cod acceptate', llm: false },
  { id: 'ask', words: ['intreaba', 'ask', 'intrebare'], usage: 'întreabă <întrebare>', what: 'răspuns din documentație (cerințele de business din README, arhitectura) și din raport, cu sursele', llm: true },
  { id: 'code', words: ['cod', 'code', 'scrie', 'implementeaza', 'repara'], usage: 'cod <sarcina>', what: 'scrie codul cerut cu un model deschis local, rulează testele, deschide un pull request pe o ramură agent/… (nu face merge)', llm: true, coder: true },
]);

const BY_WORD = new Map(COMMANDS.flatMap((c) => c.words.map((w) => [fold(w), c])));

/**
 * Parse the text of a comment or a terminal line.
 * In a comment, the command is the first line that starts with `/agent`; on the terminal the prefix
 * is optional. Everything after the command word is the argument (the following lines included).
 * @returns {{id:string, word:string|null, args:string, llm:boolean, coder:boolean, ok:boolean, reason:string|null}}
 */
export function parseCommand(text, { requirePrefix = false } = {}) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n');
  let start = lines.findIndex((l) => /^\s*\/agent\b/i.test(l));
  if (start < 0 && requirePrefix) return { id: 'none', word: null, args: '', llm: false, coder: false, ok: false, reason: 'comentariul nu începe cu /agent' };
  if (start < 0) start = lines.findIndex((l) => l.trim());
  if (start < 0) return { id: 'help', word: null, args: '', llm: false, coder: false, ok: true, reason: null };
  const first = lines[start].replace(/^\s*\/agent\b:?/i, '').trim();
  const rest = lines.slice(start + 1).join('\n').trim();
  if (!first && !rest) return { id: 'help', word: null, args: '', llm: false, coder: false, ok: true, reason: null };
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(first) ?? [first, '', ''];
  let word = fold(m[1]).replace(/[:,.!]+$/, '');
  let args = [m[2] ?? '', rest].filter(Boolean).join('\n').trim();
  // Two-word commands ("de ce …").
  if (word === 'de' && /^ce\b/i.test(args)) {
    word = 'de ce';
    args = args.replace(/^ce\b\s*/i, '');
  }
  const c = BY_WORD.get(word);
  if (!c) {
    // A question without a command word is a question.
    const q = [first, rest].filter(Boolean).join('\n').trim();
    return { id: 'ask', word: null, args: q, llm: true, coder: false, ok: true, reason: 'fără cuvânt de comandă: tratat ca întrebare' };
  }
  return { id: c.id, word, args, llm: Boolean(c.llm), coder: Boolean(c.coder), ok: true, reason: null };
}

/** The help text (Markdown). */
export function helpText({ prefix = '/agent ' } = {}) {
  const lines = ['**Comenzi** (diacriticele sunt opționale):', ''];
  for (const c of COMMANDS) lines.push(`- \`${prefix}${c.usage}\` — ${c.what}${c.coder ? ' — doar pentru proprietar și colaboratori' : ''}`);
  lines.push('', 'Gratuit: răspunsurile vin din memoria agentului și din raportul lui; „întreabă” și „cod” folosesc un model deschis rulat local în runner (fără cont, fără cheie). Cercetare, nu sfat financiar.');
  return lines.join('\n');
}

/** A run id from an argument: "run 123", a bare number, or an Actions run URL. */
export function runIdOf(args) {
  const a = String(args ?? '');
  const url = /actions\/runs\/(\d+)/.exec(a);
  if (url) return Number(url[1]);
  const m = /^(?:run\s+)?(\d{6,})\b/i.exec(a.trim());
  return m ? Number(m[1]) : null;
}

/** A branch-safe slug of a task. */
export function slugOf(text, max = 40) {
  const s = fold(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return s || 'sarcina';
}
