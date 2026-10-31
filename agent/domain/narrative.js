/**
 * NARRATIVE — the agent's summary in plain Romanian, written either by a local open model or by a
 * deterministic template, and in both cases bound to the facts.
 *
 * The model is free and runs inside the GitHub runner (no account, no key, nothing leaves the
 * runner), but a small model can still invent a number. So whatever it writes passes a guard before
 * it is published:
 *   · every number in the text must be one of the numbers in the facts (rounded forms allowed);
 *   · no trading language (buy / sell / guaranteed) — the project is research only;
 *   · no links, a bounded length.
 * A text that fails the guard is discarded and the template is published instead, with the reason.
 *
 * Pure.
 */
import { isNum, round } from './stats.js';
import { STATUS_RO } from './gates.js';

const SEV_RO = { critical: 'critic', serious: 'serios', warning: 'atenționare', info: 'info' };
/** Romanian numerals take "de" from 20 on (and for round hundreds): „3 porți”, „28 de porți”. */
export const nr = (n, noun) => `${n} ${Number.isInteger(n) && (n % 100 >= 20 || (n !== 0 && n % 100 === 0)) ? 'de ' : ''}${noun}`;
const cut = (s, n = 220) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The compact facts the narrator may use — and the only numbers it may write. */
export function buildFacts(report) {
  const e = report.efficiency ?? {};
  const c = report.calibration ?? {};
  return {
    stare: report.overall,
    porti: report.summary?.counts ?? {},
    total: report.summary?.total ?? null,
    probleme: (report.findings ?? []).slice(0, 6).map((f) => ({
      poarta: f.title,
      stare: f.status,
      gravitate: f.severity,
      valoare: f.value,
      dovada: cut(f.evidence, 200),
      remediu: cut(f.remedy, 200),
      ocurente: f.count,
      lectie: f.lesson?.lastFix ? `rezolvat ultima dată de commitul ${f.lesson.lastFix.sha?.slice(0, 7)} „${cut(f.lesson.lastFix.message, 80)}”` : f.lesson?.transient ? `s-a rezolvat singur de ${f.lesson.transient} ori` : null,
    })),
    cadenta: e.cadence ?? null,
    eficienta: { permanent: e.capability?.permanent ?? null, cuChei: e.capability?.withKeys ?? null, realizat: e.capability?.achieved ?? null, prospetime: e.freshness?.observed ?? null, prospetimePromisa: e.freshness?.promised ?? null, fiabilitate: e.reliability ?? null, efectiva: e.effective ?? null, design: e.design ?? null, parghii: (e.levers ?? []).map((l) => ({ ce: l.label, puncte: l.points })) },
    calibrare: { cohorte: c.cohorts ?? 0, prognoze: c.predictions ?? 0, atinse20x: c.interim?.['20']?.observed ?? 0, atinse100x: c.interim?.['100']?.observed ?? 0 },
    invatare: report.learning ? { rulari: report.learning.runs, normeInvatate: report.learning.normsLearned, incidenteDeschise: report.learning.incidents?.open ?? 0, incidenteRezolvate: report.learning.incidents?.resolved ?? 0, remedieri: report.learning.fixes ?? 0 } : null,
    actiuni: (report.actions ?? []).filter((a) => a.ok !== false).map((a) => ({ workflow: a.workflow, motiv: cut(a.reason, 120) })),
  };
}

/** The deterministic summary: always available, always true. */
export function templateNarrative(report) {
  const s = report.summary ?? { counts: {} };
  const k = s.counts ?? {};
  const lines = [];
  lines.push(`Stare generală: ${STATUS_RO[report.overall] ?? report.overall} — ${nr(k.PASS ?? 0, 'porți trecute')}, ${nr(k.WARN ?? 0, 'atenționări')}, ${nr(k.FAIL ?? 0, 'eșecuri')}, ${(k.UNKNOWN ?? 0) + (k.LEARNING ?? 0)} în învățare sau fără date (${s.total ?? 0} în total).`);
  const f = report.findings ?? [];
  if (f.length) {
    const top = f[0];
    const lesson = top.lesson?.lastFix ? ` Data trecută s-a rezolvat prin commitul ${top.lesson.lastFix.sha?.slice(0, 7)} („${cut(top.lesson.lastFix.message, 80)}”).` : top.lesson?.transient ? ` S-a rezolvat singur de ${top.lesson.transient} ori până acum.` : '';
    lines.push(`Prioritatea 1 (${SEV_RO[top.severity] ?? top.severity}): ${top.title} — ${cut(top.evidence, 200)}${top.remedy ? ` Remediu: ${cut(top.remedy, 200)}` : ''}${lesson}`);
    if (f.length > 1) lines.push(`Alte probleme: ${f.slice(1, 5).map((x) => `${x.title} (${x.value ?? STATUS_RO[x.status]})`).join('; ')}${f.length > 5 ? `; încă ${f.length - 5}` : ''}.`);
  } else {
    lines.push('Nicio poartă nu este în atenționare sau eșec.');
  }
  const e = report.efficiency;
  if (e?.capability) {
    const lever = e.levers?.[0];
    lines.push(`Eficiență față de un desk profesional: paritate ${e.capability.permanent}% permanent, ${e.capability.withKeys}% cu chei gratuite, ${e.capability.achieved}% realizat în ultima rulare; prospețime livrată ${e.freshness?.observed ?? '—'}% (promisă ${e.freshness?.promised ?? '—'}%), fiabilitate ${e.reliability ?? '—'}% — eficiență efectivă ${e.effective ?? '—'}% față de ținta de design ${e.design ?? '—'}%.${lever ? ` Cea mai mare pârghie: ${lever.label} (${lever.points} puncte).` : ''}`);
  }
  const l = report.learning;
  if (l) lines.push(`Învățare: ${nr(l.runs, l.runs === 1 ? 'rulare a agentului' : 'rulări ale agentului')}, ${nr(l.normsLearned, 'norme învățate')}, ${nr(l.incidents?.open ?? 0, 'incidente deschise')} și ${l.incidents?.resolved ?? 0} rezolvate${l.learnedThisRun?.incidentsFromHistory ? ` (${l.learnedThisRun.incidentsFromHistory} reconstruite acum din istoricul rulărilor)` : ''}, ${nr(l.fixes ?? 0, 'remedieri reținute')}; ${nr(report.calibration?.predictions ?? 0, 'prognoze')} în registrul de calibrare.`);
  const acts = (report.actions ?? []).filter((a) => a.ok !== false);
  if (acts.length) lines.push(`Acțiuni: ${acts.map((a) => `a pornit ${a.workflow} (${cut(a.reason, 100)})`).join('; ')}.`);
  return lines.join('\n');
}

/** The prompt for the local model. */
export function buildPrompt(facts) {
  return {
    system: 'Ești agentul de calitate al proiectului CRI Radar (cercetare crypto pe surse gratuite, fără tranzacționare). Scrii în limba română corectă, cu diacritice, concis, pentru operatorul proiectului. Reguli stricte: folosești DOAR cifrele din FAPTE, copiate exact; nu inventezi cauze, cifre sau date; nu dai sfaturi de investiții; nu scrii linkuri; fără introducere și fără formule de politețe.',
    prompt: `FAPTE (JSON):\n${JSON.stringify(facts)}\n\nScrie între 4 și 6 rânduri, fiecare începând cu „- ”:\n1) starea generală și câte porți sunt în fiecare stare;\n2) cea mai importantă problemă, cu dovada și remediul ei;\n3) celelalte probleme, pe scurt;\n4) eficiența față de un desk profesional: paritate, prospețime, eficiență efectivă și cea mai mare pârghie;\n5) ce a învățat agentul și ce acțiuni a luat.\nMaximum 150 de cuvinte.`,
  };
}

/* ───────────────────────────── guard ───────────────────────────── */

const FORBIDDEN = /\b(cumpăr\w*|cumpar\w*|vinde\w*|vindeț\w*|vânde\w*|vând\b|garantat\w*|investiț\w*|investi\w*|profit garantat|buy|sell)\b/i;

/** Number tokens in a text, each with its possible readings (Romanian decimal comma, thousands dot). */
export function numbersIn(text) {
  const cleaned = String(text)
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g, ' ') // ISO dates and times
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ') // clock times
    .replace(/^\s*(?:[-•*]\s+)?(?:\d{1,2}[.)]\s+)?/gm, ' ') // list markers ("- ", "1) ", "- 2. ")
    .replace(/\b[0-9a-f]{7,40}\b/gi, (m) => (/[a-f]/i.test(m) ? ' ' : m)); // commit hashes
  const out = [];
  for (const m of cleaned.matchAll(/(?<![\w.,])(\d{1,3}(?:[ .]\d{3})+|\d+)(?:[.,](\d+))?(?![\w])/g)) {
    const intPart = m[1];
    const frac = m[2];
    const readings = new Set();
    const plainInt = intPart.replace(/[ .]/g, '');
    if (frac !== undefined) {
      readings.add(Number(`${plainInt}.${frac}`));
      if (/^\d{3}$/.test(frac)) readings.add(Number(`${plainInt}${frac}`)); // "10.000" read as ten thousand
    } else readings.add(Number(plainInt));
    if (/[ .]/.test(intPart)) readings.add(Number(intPart.replace(/ /g, '').split('.').join('.')));
    out.push({ token: m[0], readings: [...readings].filter(Number.isFinite) });
  }
  return out;
}

/** Every number the facts contain, including those inside their strings, in the forms a text may use. */
export function allowedNumbers(facts) {
  const vals = [];
  const walk = (x) => {
    if (isNum(x)) vals.push(x);
    else if (typeof x === 'string') for (const n of numbersIn(x)) vals.push(...n.readings);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(facts);
  const set = new Set();
  for (const v of vals) {
    for (const w of [v, v * 100, v / 100]) {
      set.add(w);
      for (const d of [0, 1, 2]) set.add(round(w, d));
      set.add(Math.trunc(w));
    }
  }
  return set;
}

/**
 * @returns {{ok:boolean, reasons:string[], unknownNumbers:string[]}}
 */
export function guardNarrative(text, facts) {
  const reasons = [];
  const t = String(text ?? '').trim();
  if (t.length < 60) reasons.push('prea scurt');
  if (t.length > 1800) reasons.push('prea lung');
  if (/https?:\/\//i.test(t)) reasons.push('conține linkuri');
  const bad = FORBIDDEN.exec(t);
  if (bad) reasons.push(`limbaj de tranzacționare („${bad[0]}”)`);
  const allowed = allowedNumbers(facts);
  const has = (r) => allowed.has(r) || [...allowed].some((a) => Math.abs(a - r) < 1e-9);
  const unknown = numbersIn(t).filter((n) => !n.readings.some(has)).map((n) => n.token);
  if (unknown.length) reasons.push(`cifre care nu apar în fapte: ${[...new Set(unknown)].slice(0, 6).join(', ')}`);
  return { ok: reasons.length === 0, reasons, unknownNumbers: unknown };
}

/** Fingerprint of what the narrative is about: it is rewritten only when this changes (or it ages). */
export function narrativeKey(report) {
  return [report.overall, ...(report.findings ?? []).map((f) => `${f.id}:${f.status}`), ...(report.actions ?? []).map((a) => `act:${a.workflow}`)].join('|');
}
