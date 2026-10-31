/**
 * CHAT ANSWERS — what the agent says when the owner asks, written from its report, its memory and
 * the project's documentation. Every deterministic answer is built from facts the agent measured;
 * an answer a language model writes passes the same guard as the narrative (every number must come
 * from the context it was given, no links, no trading language), otherwise the deterministic answer
 * stands, with the reason.
 *
 * Pure.
 */
import { STATUS_RO } from './gates.js';
import { allowedNumbers, nr, numbersIn } from './narrative.js';
import { isNum, round } from './stats.js';

export const CHAT_MARKER = '<!-- cri-agent-chat -->';
export const MAX_REPLY = 60_000;

const ICON = { PASS: '✅', WARN: '⚠️', FAIL: '❌', UNKNOWN: '·', LEARNING: '…' };
const ORDER = { FAIL: 0, WARN: 1, UNKNOWN: 2, LEARNING: 3, PASS: 4 };
const pct = (x, d = 1) => (isNum(x) ? `${round(x, d)}%` : '—');
const cut = (s, n = 400) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const cell = (s) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The reply as posted: marker, title, body, footer; bounded to GitHub's comment size. */
export function wrapReply({ title, body, footer = null }) {
  const text = [CHAT_MARKER, `### ${title}`, '', body, '', `<sub>${footer ?? 'Agentul AI al CRI Radar — răspuns din memoria și raportul agentului. Cercetare, nu sfat financiar.'}</sub>`].join('\n');
  return text.length > MAX_REPLY ? `${text.slice(0, MAX_REPLY - 200)}\n\n… (răspuns trunchiat la limita unui comentariu)` : text;
}

const noReport = () => 'Nu există încă un raport al agentului (prima rulare a workflow-ului „Agent AI” îl creează pe ramura `cri-agent`). Local: `npm run agent:sync`, apoi întrebați din nou.';

/* ───────────────────────────── status, gates ───────────────────────────── */

export function answerStatus(report) {
  if (!report) return noReport();
  const k = report.summary?.counts ?? {};
  const out = [`**Stare generală: ${STATUS_RO[report.overall] ?? report.overall}** — ${k.PASS ?? 0} trecute · ${k.WARN ?? 0} atenționări · ${k.FAIL ?? 0} eșecuri · ${(k.UNKNOWN ?? 0) + (k.LEARNING ?? 0)} fără date sau în învățare (${report.summary?.total ?? 0} porți), raport din ${String(report.generatedAt).slice(0, 16).replace('T', ' ')} UTC${report.mode === 'demo' ? ' (DEMO)' : ''}.`, ''];
  const f = report.findings ?? [];
  if (f.length) {
    out.push('**Ce cere atenție:**');
    for (const x of f.slice(0, 8)) out.push(`- ${ICON[x.status]} **${x.title}**${x.value ? ` (${x.value})` : ''} — ${cut(x.evidence, 260)}${x.remedy ? ` _Remediu:_ ${cut(x.remedy, 200)}` : ''}`);
    out.push('');
  } else out.push('Nicio poartă în atenționare sau eșec.', '');
  const e = report.efficiency;
  if (e?.capability) out.push(`**Eficiență față de un desk profesional:** ${pct(e.effective)} efectiv (design ${pct(e.design)}) — paritate ${pct(e.capability.achieved)}, prospețime ${pct(e.freshness?.observed)}, fiabilitate ${pct(e.reliability)}.`);
  const id = report.identification?.short;
  const early = id?.tiers?.find((t) => t.id === 'EARLY');
  if (early?.ready) out.push(`**Identificare:** banda TIMPURIU ${pct(early.ratePct)} au atins +${id.thresholdPct}% în ${id.horizonH} h față de ${pct(id.baseRatePct)} în univers (lift ${early.lift}).`);
  const se = report.selfEval;
  if (se) out.push(`**Auto-evaluare:** ${se.runsScored} rulări notate${isNum(se.brier) ? `, Brier ${se.brier} (regula naivă ${se.brierPersistence})` : ''}${se.ready ? '' : ` (verdict după ${se.minRuns})`}.`);
  const n = report.narrative;
  if (n?.text) out.push('', '**Rezumatul agentului:**', ...n.text.split('\n').filter(Boolean).map((l) => `> ${l.replace(/^-\s*/, '')}`));
  return out.join('\n');
}

export function answerGates(report, arg = '') {
  if (!report) return noReport();
  const a = String(arg ?? '').trim().toLowerCase();
  let gates = report.gates ?? [];
  if (a) gates = gates.filter((g) => g.group === a || g.id === a || g.id.startsWith(`${a}.`) || g.id.includes(a));
  if (!gates.length) return `Nicio poartă pentru „${arg}”. Grupuri: ${(report.groups ?? []).map((g) => `\`${g.id}\``).join(', ')}.`;
  gates = [...gates].sort((x, y) => (ORDER[x.status] ?? 9) - (ORDER[y.status] ?? 9));
  const rows = ['| | Poartă | Valoare | Dovadă |', '|---|---|---|---|', ...gates.map((g) => `| ${ICON[g.status] ?? ''} | ${cell(g.title)} \`${g.id}\` | ${cell(g.value)} | ${cell(cut(g.evidence, 300))} |`)];
  return [`${gates.length} porți${a ? ` (${a})` : ''}, întâi cele care nu trec. Detalii pentru una: \`/agent diagnoză <id>\`.`, '', ...rows].join('\n');
}

/* ───────────────────────────── identification, rules, learning ───────────────────────────── */

export function answerEfficiency(report) {
  if (!report) return noReport();
  const ids = report.identification;
  if (!ids) return 'Eficiența identificării are nevoie de istoricul scanărilor (`discovery.json` de pe ramura `cri-state`); agentul nu l-a găsit în această rulare.';
  const out = [];
  for (const [w, e] of Object.entries(ids)) {
    if (!e?.tiers) continue;
    out.push(`**${e.label ?? w}** — ${e.observations} observații din ${e.scans} scanări (${e.assets} proiecte), ${e.movers} mișcări; rata universului ${pct(e.baseRatePct)}${e.from ? `; ${String(e.from).slice(0, 10)} → ${String(e.to).slice(0, 10)}` : ''}.`, '');
    if (!e.observations) {
      out.push('_Nicio observație cu orizontul încheiat încă._', '');
      continue;
    }
    out.push('| Nivel | Obs. | Proiecte | Au atins | Interval 90% | Lift | Recall | Rezultat median | Eșantion |', '|---|---:|---:|---:|---|---:|---:|---:|---|');
    for (const t of e.tiers) out.push(`| ${cell(t.label)} | ${t.n} | ${t.assets} | ${pct(t.ratePct)} | ${pct(t.loPct)}–${pct(t.hiPct)} | ${t.lift ?? '—'} | ${pct(t.recallPct)} | ${pct(t.medianEndPct)} | ${t.ready ? 'suficient' : 'mic'} |`);
    out.push('');
  }
  const rec = (report.rules?.recommendations ?? []).filter((r) => r.id.startsWith('ID-'));
  if (rec.length) out.push('**Recomandări (decizia proprietarului):**', ...rec.map((r) => `- ${r.id} ${r.title}: ${r.text}`), '');
  out.push(`_${report.identification?.note ?? ''}_`);
  return out.join('\n');
}

export function answerRules(report, arg = '') {
  if (!report) return noReport();
  const r = report.rules;
  if (!r?.results?.length) return 'Regulile fundamentale nu sunt încă în raport (agent/knowledge/rules.json se încarcă la fiecare rulare).';
  const a = String(arg ?? '').trim().toUpperCase();
  if (a) {
    const x = r.results.find((y) => y.id === a);
    if (!x) return `Nu există regula „${arg}”. Regulile: ${r.results.map((y) => y.id).join(', ')}.`;
    const t = x.trend;
    return [`**${x.id} — ${x.title}** ${ICON[x.status]} ${STATUS_RO[x.status]}${x.value ? ` (${x.value})` : ''}`, '', `> ${x.rule}`, '', x.why ? `_De ce:_ ${x.why}` : null, `**Dovada de acum:** ${x.evidence}`, x.recommendation ? `**Recomandare:** ${x.recommendation}` : null, t ? `**Istoric:** ${nr(t.runs, t.runs === 1 ? 'rulare evaluată' : 'rulări evaluate')}; în ultimele ${t.recent}: ${Object.entries(t.by).filter(([, n]) => n).map(([s, n]) => `${STATUS_RO[s]} ×${n}`).join(', ')}${t.changedAt ? `; ultima schimbare de verdict ${t.changedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}.` : null].filter(Boolean).join('\n');
  }
  const out = [`**${r.title ?? 'Reguli fundamentale'}** — v${r.version}, amprentă \`${r.hash}\`: ${r.counts.PASS} trecute, ${r.counts.WARN} atenționări, ${r.counts.FAIL} eșuate, ${r.counts.LEARNING} în învățare, ${r.counts.UNKNOWN} fără date.`, ''];
  for (const area of r.areas ?? []) {
    const list = r.results.filter((x) => x.area === area.id);
    if (!list.length) continue;
    out.push(`**${area.label}**`, ...list.map((x) => `- ${ICON[x.status]} \`${x.id}\` ${x.title}${x.value ? ` — ${x.value}` : ''}`), '');
  }
  out.push('Detaliile unei reguli: `/agent reguli ID-1`. Pragurile se schimbă doar printr-un commit al proprietarului în `agent/knowledge/rules.json` (P-5).');
  return out.join('\n');
}

export function answerLearning(report) {
  if (!report) return noReport();
  const se = report.selfEval;
  const l = report.learning ?? {};
  const out = [];
  if (se) {
    out.push(`**Auto-evaluare (predicții pentru rularea următoare):** ${se.runsScored} rulări notate, ${se.predictions} predicții${se.ready ? '' : ` — verdict după ${se.minRuns} rulări`}.`);
    if (isNum(se.brier)) out.push(`- Brier agent ${se.brier} · „ca data trecută” ${se.brierPersistence} · frecvența simplă ${se.brierClimatology} (mai mic = mai bine).`, se.comparable ? `- **Skill ${se.skill}** față de „ca data trecută”, pe ${se.changes} schimbări de stare (≥ 0 = memoria anticipează cel puțin la fel de bine ca regula naivă).` : `- Doar ${se.changes} schimbări de stare (sub ${se.minChanges}): regula naivă nu poate fi încă bătută, deci comparația se face cu frecvența simplă — **skill ${se.skillVsClimatology}**.`);
    if (se.curve?.length) out.push(`- Curba de învățare (Brier pe ferestre de ${se.curve[0].runs} rulări): ${se.curve.map((c) => `${String(c.to).slice(5, 16).replace('T', ' ')}: ${c.brier}`).join(' → ')}${isNum(se.brierTrend) ? ` (${se.brierTrend <= 0 ? 'scade' : 'crește'} cu ${Math.abs(se.brierTrend)})` : ''}.`);
    if (se.coverage?.n) out.push(`- Normele învățate: ${pct(se.coverage.insidePct)} din ${se.coverage.n} valori noi au căzut în banda p10–p90 a seriei de dinainte (ținta ${se.coverage.targetPct}%).`);
    if (se.nextRun?.watch?.length) out.push(`- Porți care ar putea cere atenție la rularea următoare: ${se.nextRun.watch.map((w) => `\`${w.id}\` ${w.pct}%`).join(', ')}.`);
    if (se.coder) out.push(`- Propuneri de cod: ${se.coder.proposals} deschise de agent, ${se.coder.merged} acceptate (merge), ${se.coder.closed} închise fără merge, ${se.coder.open} în așteptare${isNum(se.coder.acceptancePct) ? ` — rata de acceptare ${se.coder.acceptancePct}%` : ''}.`);
    out.push('');
  }
  out.push(`**Ce a învățat din istoric:** ${l.runs ?? 0} rulări ale agentului din ${String(l.since ?? '').slice(0, 10)}; ${l.normsLearned ?? 0} norme învățate din ${l.metrics ?? 0} metrici; ${l.incidents?.resolved ?? 0} incidente rezolvate și ${l.incidents?.open ?? 0} deschise; ${l.fixes ?? 0} remedieri reținute (commitul care a închis fiecare incident), ${l.transient ?? 0} rezolvate singure.`);
  const res = report.incidents?.resolved ?? [];
  if (res.length) out.push('', '**Lecții recente:**', ...res.slice(0, 6).map((i) => `- ${i.title}: ${i.resolvedBy?.sha ? `rezolvat de \`${i.resolvedBy.sha.slice(0, 7)}\` „${cut(i.resolvedBy.message, 90)}”` : 's-a rezolvat singur'}${isNum(i.durationHours) ? `, după ${round(i.durationHours, 1)} h` : ''}.`));
  const rules = report.rules;
  if (rules?.counts) out.push('', `**Regulile fundamentale:** v${rules.version}, ${rules.counts.PASS}/${rules.total} trecute; ${(rules.knowledge?.changes ?? []).length} versiuni încărcate în memorie de la început.`);
  return out.join('\n');
}

/* ───────────────────────────── forecast ───────────────────────────── */

export function answerForecast(rows, forecast, arg) {
  const q = String(arg ?? '').trim();
  if (!q) return 'Scrieți simbolul: `/agent prognoză LAB`.';
  const up = q.toUpperCase();
  const hits = (rows ?? []).filter((r) => String(r.symbol ?? '').toUpperCase() === up || String(r.name ?? '').toUpperCase() === up);
  const out = [];
  const winner = (forecast?.winners ?? []).find((w) => String(w.symbol).toUpperCase() === up);
  if (winner) out.push(`**${winner.symbol}** este în lista de învățare: ${winner.statusLabel ?? winner.status}, ×${round(winner.multiple, 1)} de la minimul din ${winner.low?.at ?? '—'} la vârful din ${winner.peak?.at ?? '—'}${isNum(winner.drawdownNowPct) ? `, acum ${winner.drawdownNowPct}% față de vârf` : ''}.`, '');
  if (!hits.length) {
    out.push(`„${q}” nu este în universul cercetat la ultima scanare${winner ? '' : ' (nici în lista de învățare)'}.`);
    return out.join('\n');
  }
  const b100 = forecast?.baseRates?.find((b) => b.multiple === 100);
  const b20 = forecast?.baseRates?.find((b) => b.multiple === 20);
  for (const r of hits.slice(0, 3)) {
    out.push(`**${r.symbol}** (${r.name}, ${r.chain ?? '—'}): preț ${r.price}, capitalizare ${isNum(r.marketCap) ? `${round(r.marketCap / 1e6, 1)} M$` : '—'}, stadiul ${r.stage ?? '—'}, oportunitate ${r.opportunity ?? '—'}, risc ${r.risk ?? '—'}, verdict de validitate ${r.valid === 'V' ? 'verificat' : r.valid === 'R' ? 'respins' : 'în verificare'}.`);
    if (isNum(r.fc100)) out.push(`- Probabilitatea ca prețul să atingă **≥100×** prețul de azi în 12 luni: **${r.fc100}%** (rata de bază ${b100?.pct ?? '—'}%; ×${r.fcLift ?? '—'} față de ea); **≥20×**: **${r.fc20 ?? '—'}%** (bază ${b20?.pct ?? '—'}%).`);
    else out.push(`- Fără prognoză publicată (${r.valid === 'R' ? 'proiect respins de poarta de validitate' : 'proiectul nu a trecut încă de poarta de validitate'}).`);
    const top = (forecast?.top ?? []).find((t) => t.key === r.key);
    if (top?.nearest?.length) out.push(`- Cele mai apropiate amprente de câștigători: ${top.nearest.map((n) => `${n.symbol} ×${round(n.multiple, 1)} (similaritate ${n.similarity}%)`).join(', ')}.`);
  }
  out.push('', `_Evenimentul: ${forecast?.event ?? 'prețul atinge pragul în 12 luni'}. O probabilitate mică rămâne mică — prognoza ierarhizează cercetarea, nu promite un rezultat._`);
  return out.join('\n');
}

/* ───────────────────────────── diagnosis ───────────────────────────── */

/** The lessons the memory holds for a gate (incidents, fixes by signature). */
function memoryLessons(memory, gateId, signature) {
  const inc = (memory?.incidents ?? []).filter((i) => i.gate === gateId);
  const fixes = [...(memory?.fixes?.[gateId] ?? []), ...(signature ? memory?.fixes?.[`sig:${signature}`] ?? [] : [])].filter((f) => f.sha || f.transient);
  return { inc, fixes };
}

export function diagnoseGate(report, memory, gateId) {
  const g = (report?.gates ?? []).find((x) => x.id === gateId);
  if (!g) return null;
  const f = (report.findings ?? []).find((x) => x.id === gateId);
  const out = [`**${g.title}** \`${g.id}\` — ${ICON[g.status]} ${STATUS_RO[g.status]}${g.value ? ` (${g.value})` : ''}`, '', `**Ce verifică:** ${(report.gateCatalogue ?? []).find((c) => c.id === g.id)?.what ?? '—'}`, `**Dovada:** ${g.evidence}`];
  if (g.remedy && g.status !== 'PASS') out.push(`**Remediu:** ${g.remedy}`);
  if (g.signature) out.push(`**Semnătura eșecului:** \`${g.signature}\``);
  if (g.link) out.push(`**Rularea:** ${g.link}`);
  const { inc, fixes } = memoryLessons(memory, g.id, g.signature);
  if (f?.lesson?.lastFix) out.push(`**Din istoric:** data trecută s-a rezolvat prin commitul \`${String(f.lesson.lastFix.sha).slice(0, 7)}\` „${cut(f.lesson.lastFix.message, 120)}”.`);
  if (inc.length) out.push('', `**Incidente reținute pentru această poartă (${inc.length}):**`, ...inc.slice(-5).map((i) => `- ${String(i.firstSeen).slice(0, 16).replace('T', ' ')}: ${i.status === 'open' ? 'deschis' : 'rezolvat'}${i.resolvedBy?.sha ? ` de \`${i.resolvedBy.sha.slice(0, 7)}\` „${cut(i.resolvedBy.message, 90)}”` : i.resolvedBy?.transient ? ' (trecător)' : ''}${isNum(i.durationHours) ? `, ${round(i.durationHours, 1)} h` : ''}, ${i.count} rulări.`));
  else if (g.status !== 'PASS') out.push('', 'Memoria nu are încă un incident anterior pentru această poartă: este prima apariție.');
  if (fixes.length && !f?.lesson?.lastFix) out.push(`**Remedieri reținute:** ${fixes.slice(-3).map((x) => (x.sha ? `\`${x.sha.slice(0, 7)}\` „${cut(x.message, 80)}”` : 'trecător')).join('; ')}.`);
  const rule = (report.rules?.results ?? []).filter((r) => r.check === 'gate' && r.value !== undefined && r.evidence?.startsWith(g.title));
  if (rule.length) out.push(`**Reguli legate:** ${rule.map((r) => `${r.id} (${STATUS_RO[r.status]})`).join(', ')}.`);
  return out.join('\n');
}

/**
 * A failed run, read step by step.
 * @param {{run:any, jobs:any[], annotations:any[], signature:any, memory:any, commits:any[], lastSuccess:any}} o
 */
export function diagnoseRun({ run, jobs = [], annotations = [], signature = null, memory = null, commits = [], lastSuccess = null }) {
  const out = [`**Rularea ${run?.id ?? '—'}** (${run?.file ?? run?.name ?? 'workflow'}, ${run?.event ?? '—'}, ${String(run?.createdAt ?? '').slice(0, 16).replace('T', ' ')}): **${run?.conclusion ?? run?.status ?? '—'}**${run?.url ? ` — ${run.url}` : ''}`, ''];
  const failed = jobs.flatMap((j) => (j.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => `${j.name} → pasul ${s.number} „${s.name}”`));
  out.push(failed.length ? `**Pași căzuți:** ${failed.join('; ')}.` : jobs.length ? 'Niciun pas marcat „failure” (rulare anulată, expirată sau în curs).' : 'Joburile rulării nu au putut fi citite.');
  const errs = annotations.filter((a) => a.level === 'failure' || a.level === 'error' || (a.title ?? '').startsWith('gate:'));
  if (errs.length) out.push('', '**Adnotări:**', ...errs.slice(0, 6).map((a) => `- ${a.title ? `\`${a.title}\` ` : ''}${cut(a.message, 300)}${a.path ? ` (${a.path})` : ''}`));
  if (signature) {
    out.push('', `**Semnătura:** \`${signature.code}\` — ${signature.cause ?? ''}`, signature.remedy ? `**Remediu cunoscut:** ${signature.remedy}` : '');
    const fx = (memory?.fixes?.[`sig:${signature.code}`] ?? []).filter((x) => x.sha);
    if (fx.length) out.push(`**Din istoric, aceeași semnătură s-a rezolvat prin:** ${fx.slice(-3).map((x) => `\`${x.sha.slice(0, 7)}\` „${cut(x.message, 90)}”`).join('; ')}.`);
  }
  if (lastSuccess && commits.length) out.push('', `**Commituri de la ultima rulare reușită** (${String(lastSuccess.createdAt).slice(0, 16).replace('T', ' ')}) — suspecții, cel mai recent întâi:`, ...commits.slice(0, 6).map((c) => `- \`${String(c.sha).slice(0, 7)}\` ${cut(c.message, 100)} (${String(c.at).slice(0, 16).replace('T', ' ')})`));
  return out.filter((x) => x !== '').join('\n');
}

/** Every open finding, most severe first — "what is wrong and what to do". */
export function diagnoseAll(report, memory) {
  if (!report) return noReport();
  const f = report.findings ?? [];
  if (!f.length) return `Nicio poartă nu cere atenție (stare ${STATUS_RO[report.overall] ?? report.overall}). Pentru o poartă anume: \`/agent diagnoză <id>\`; pentru o rulare: \`/agent diagnoză run <id>\`.`;
  const out = [`${f.length} ${f.length === 1 ? 'problemă' : 'probleme'}, cea mai gravă întâi:`, ''];
  for (const x of f.slice(0, 4)) {
    const d = diagnoseGate(report, memory, x.id);
    out.push(d ?? `**${x.title}** — ${x.evidence}`, '', '---', '');
  }
  return out.join('\n');
}

/* ───────────────────────────── ask ───────────────────────────── */

/** Without a model: the passages that answer, quoted with their source. */
export function retrievalAnswer(question, passages) {
  if (!passages.length) return `Nu am găsit în documentație (README, ARHITECTURĂ, manualul agentului) un pasaj despre „${cut(question, 120)}”. Încercați alte cuvinte sau \`/agent ajutor\`.`;
  return [`Pasajele din documentație care răspund la „${cut(question, 160)}”:`, '', ...passages.map((p) => `**${p.doc} › ${p.path || p.heading}**\n\n${cut(p.text, 1200)}\n`)].join('\n');
}

export function askPrompt(question, passages, facts) {
  return {
    system: 'Ești agentul AI al proiectului CRI Radar (cercetare crypto pe surse gratuite, fără tranzacționare). Răspunzi în limba română corectă, cu diacritice, concis și exact, DOAR din CONTEXTUL dat (pasaje din documentația proiectului și faptele măsurate de agent). Dacă răspunsul nu este în context, spui clar că nu știi. Nu inventezi cifre, nu dai sfaturi de investiții, nu scrii linkuri. La final scrii „Surse:” și titlurile pasajelor folosite.',
    prompt: `CONTEXT — pasaje:\n${passages.map((p, i) => `[${i + 1}] ${p.doc} › ${p.path || p.heading}\n${p.text}`).join('\n\n')}\n\nCONTEXT — fapte (JSON):\n${JSON.stringify(facts)}\n\nÎNTREBARE: ${question}\n\nRăspuns (maximum 220 de cuvinte):`,
  };
}

const FORBIDDEN = /\b(cumpăr\w*|cumpar\w*|vinde\w*|vânde\w*|garantat\w*|profit garantat|buy|sell)\b/i;

/** The guard of a model's answer: numbers only from the context, no links, no trading language. */
export function guardAnswer(text, context) {
  const reasons = [];
  const t = String(text ?? '').trim();
  if (t.length < 20) reasons.push('prea scurt');
  if (t.length > 4000) reasons.push('prea lung');
  if (/https?:\/\//i.test(t)) reasons.push('conține linkuri');
  const bad = FORBIDDEN.exec(t);
  if (bad) reasons.push(`limbaj de tranzacționare („${bad[0]}”)`);
  const allowed = allowedNumbers(context);
  const has = (r) => allowed.has(r) || [...allowed].some((a) => Math.abs(a - r) < 1e-9);
  const unknown = numbersIn(t).filter((n) => !n.readings.some(has)).map((n) => n.token);
  if (unknown.length) reasons.push(`cifre care nu apar în context: ${[...new Set(unknown)].slice(0, 6).join(', ')}`);
  return { ok: reasons.length === 0, reasons };
}

/* ───────────────────────────── code ───────────────────────────── */

export const CODE_RULES = [
  'Node.js ≥ 22, ES modules, zero dependențe npm; testele cu node:test și node:assert/strict (npm test).',
  'Arhitectură hexagonală: src/domain și agent/domain sunt pure și deterministe (fără I/O și rețea, fără citirea ceasului — timpul vine ca argument nowMs —, fără numere aleatoare); src/application și agent/application vorbesc cu lumea doar prin porturi; orice I/O stă în adaptoare.',
  'agent/ este un modul separat: nu importă nimic din src/ sau web/, și nici ele din agent/.',
  'Doar surse gratuite: un adaptor apelează numai hosturile de pe lista aprobată; nimic cu abonament; niciun endpoint de ordine sau retragere (proiectul este exclusiv research).',
  'Cheile API stau doar în GitHub Secrets: niciodată în cod, HTML sau JS publicat.',
  'Necunoscut nu înseamnă negativ: o valoare lipsă rămâne null, nu 0.',
  'Pragurile de business (verdictul Stage 1–2, oportunitate > 75, risc < 60; benzile 90/75/60/40) nu se schimbă decât dacă sarcina o cere explicit.',
  'Textele pentru utilizator sunt în limba română, cu diacritice.',
];

export function codePrompt({ task, files, failures = null, previous = null }) {
  const sys = [
    'Ești agentul de cod al proiectului CRI Radar. Scrii cod corect, minim și testat, care respectă regulile proiectului:',
    ...CODE_RULES.map((r) => `- ${r}`),
    '',
    'Răspunzi DOAR cu blocuri de editare, în formatul exact (fără alt text în afara blocurilor):',
    'FILE: cale/relativa/fisier.js',
    '<<<<<<< SEARCH',
    '(liniile existente, copiate exact, întregi, cu indentarea lor)',
    '=======',
    '(liniile noi)',
    '>>>>>>> REPLACE',
    'Pentru un fișier nou, SEARCH rămâne gol. Fiecare bloc SEARCH trebuie să apară o singură dată în fișier; folosiți câteva linii de context ca să fie unic. Când schimbați comportamentul, adăugați sau actualizați testul.',
  ].join('\n');
  const ctx = files.map((f) => `FILE: ${f.path}\n\`\`\`\n${f.text}\n\`\`\``).join('\n\n');
  const repair = failures ? `\n\nPRIMA ÎNCERCARE a produs aceste schimbări:\n\`\`\`diff\n${String(previous ?? '').slice(0, 6000)}\n\`\`\`\nTestele au eșuat:\n\`\`\`\n${String(failures).slice(-5000)}\n\`\`\`\nScrie blocurile care repară eșecurile (față de fișierele așa cum sunt ACUM, cu schimbările de mai sus aplicate).` : '';
  return { system: sys, prompt: `SARCINA: ${task}\n\nFIȘIERE RELEVANTE (conținut actual):\n\n${ctx}${repair}\n\nBlocurile de editare:` };
}

export function prBody({ task, author = null, model = null, changed = [], created = [], tests = null, rounds = 1, issue = null, problems = [] }) {
  return [
    CHAT_MARKER,
    `**Sarcina${author ? ` (cerută de @${author})` : ''}:** ${task}`,
    '',
    `**Fișiere:** ${changed.map((p) => `\`${p}\`${created.includes(p) ? ' (nou)' : ''}`).join(', ') || '—'}`,
    `**Testele (\`npm test\`, în jobul fără permisiuni de scriere):** ${tests ? (tests.ok ? '✅ trecute' : `❌ eșuate — ${cut(tests.summary, 300)}`) : 'nerulate'}${rounds > 1 ? ` (după ${rounds - 1} rundă de reparare)` : ''}.`,
    problems.length ? `**Atenție:** ${problems.join('; ')}` : null,
    '',
    `Scris de agentul AI cu un model deschis rulat local în runner${model ? ` (\`${model}\`)` : ''} — gratuit, fără cont și fără cheie. CI rulează pe ramură (workflow_dispatch). **Revizuiți înainte de merge:** agentul nu face merge și nu scrie niciodată în main.`,
    issue ? `\nCerut în #${issue}.` : null,
  ].filter((x) => x !== null).join('\n');
}

/** The last lines of a test run that say what failed. */
export function testSummary(output) {
  const lines = String(output ?? '').split('\n');
  const fails = lines.filter((l) => /^\s*(not ok|✖|✗)\b|\bfailing\b|AssertionError|Error:/.test(l)).slice(0, 12);
  const tail = lines.filter((l) => /^ℹ (tests|pass|fail)\b|^# (tests|pass|fail)\b/.test(l)).slice(-3);
  return [...fails, ...tail].join('\n').slice(0, 2000) || lines.slice(-15).join('\n').slice(0, 2000);
}
