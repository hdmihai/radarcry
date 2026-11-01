/**
 * CHAT ANSWERS — what the agent says when the owner asks, in plain text: short sentences, in the
 * first person, Romanian numbers, local time, no markup (it is read on a phone and in a terminal).
 *
 * Every deterministic answer is built from facts the agent measured (its report and its memory). An
 * answer a language model writes passes the same guard as the narrative — every number must come
 * from the context it was given, no links, no trading language — and is cleaned of any markup;
 * otherwise the deterministic answer stands, with the reason.
 *
 * Pure.
 */
import { COMMANDS, fold } from './commands.js';
import { STATUS_RO } from './gates.js';
import { allowedNumbers, numbersIn } from './narrative.js';
import { DEFAULT_TZ, cut, day, isoText, list, n, passage, pct, plain, ro, roText, unwrap, when } from './plain.js';
import { AREAS } from './rules.js';
import { isNum } from './stats.js';

/** The invisible markers of the agent's GitHub texts: a chat answer, and the findings issue. */
export const CHAT_MARKER = '<!-- cri-agent-chat -->';
export const ISSUE_MARKER = '<!-- cri-agent -->';
export const MAX_REPLY = 60_000;
const H = 3_600_000;

const ORDER = { FAIL: 0, WARN: 1, UNKNOWN: 2, LEARNING: 3, PASS: 4 };
const ST = { PASS: 'trece', WARN: 'în atenționare', FAIL: 'eșuată', UNKNOWN: 'fără date', LEARNING: 'încă în învățare' };
/** A measured text from the report, as the agent says it: no markup, Romanian decimals. */
const txt = (s, tz = DEFAULT_TZ) => roText(isoText(plain(s), tz));
const short = (s, tz = DEFAULT_TZ) => cut(txt(s, tz).replace(/\.$/, ''), 200);
const val = (v) => (v ? roText(v) : v);
/** How a GitHub Actions run ended, in words. */
const CONCLUSION = { success: 'a reușit', failure: 'a eșuat', cancelled: 'a fost anulată', timed_out: 'a expirat', startup_failure: 'nu a pornit', skipped: 'a fost sărită', action_required: 'așteaptă o aprobare', neutral: 's-a încheiat neutru', stale: 'a fost abandonată' };
export const conclusionRo = (c) => CONCLUSION[c] ?? (c ? `s-a încheiat cu „${c}”` : 'nu s-a încheiat încă');
/** „o dată”, „de 3 ori”, „de 24 de ori”. */
const times = (c) => (c === 1 ? 'o dată' : `de ${n(c, 'dată', 'ori')}`);
/** „nicio atenționare”, „1 atenționare”, „3 atenționări”. */
const count = (c, one, many, none) => (c ? n(c, one, many) : none);

/** The reply as posted: an invisible marker for GitHub, the answer, one signature line. */
export function wrapReply({ body, footer = null }) {
  const text = [CHAT_MARKER, plain(body), '', `— ${footer ?? 'Agentul AI al CRI Radar. Cercetare, nu sfat financiar.'}`].join('\n');
  return text.length > MAX_REPLY ? `${text.slice(0, MAX_REPLY - 120)}\n\n… (răspunsul a fost scurtat la limita unui comentariu)` : text;
}

const noReport = () => 'Încă nu am un raport: prima rulare a workflow-ului „Agent AI” îl creează pe ramura cri-agent. Pe telefon sau în Termux, rulează npm run agent:sync și întreabă-mă din nou.';

/* ───────────────────────────── greeting, help ───────────────────────────── */

export function answerHelp({ orphan = null } = {}) {
  const short = COMMANDS.filter((c) => c.id !== 'help').map((c) => c.usage.replace(/ \[.*\]| <.*>/, ''));
  return [
    ...(orphan ? [`Nu știu încă la ce se referă „${cut(orphan, 40)}”: o continuare scurtă ca aceasta duce mai departe întrebarea de dinainte, iar aici nu am una.`, ''] : []),
    'Îmi poți scrie în cuvintele tale, cu sau fără diacritice. De exemplu:',
    '- „cum stă radarul azi?” — starea proiectului și ce cere atenție',
    '- „ce s-a schimbat de ieri?” — probleme noi, rezolvate și ce am făcut eu',
    '- „de ce a picat scanarea?” sau „ce nu merge la site?” — diagnoza, cu pasul căzut și reparația care a mers data trecută',
    '- „ce proiecte semnalează radarul?” — candidații de research de acum',
    '- „cât de bine prinde radarul proiectele bune?” — eficiența identificării',
    '- „ce șanse are LAB?” sau „care au cele mai mari probabilități?” — prognoza ≥100× și ≥20×',
    '- „ce reguli nu trec?” sau „ce spune regula ID-5?” — regulile fundamentale',
    '- „ce ai învățat?” — auto-evaluarea mea',
    '- „cum se calculează prognoza?” — explicații din documentație',
    '- „scrie un test pentru …” sau „adaugă în cod …” — scriu codul, rulez testele și deschid un pull request; decizia de merge rămâne a ta',
    '',
    'După un răspuns poți continua scurt: „de ce?”, „cum repar?”, „detalii”.',
    'Pe GitHub îmi scrii direct într-o problemă al cărei titlu începe cu „Agent” (de exemplu „Agent AI — întrebare”); în rest, începe comentariul cu /agent. În Termux: npm run agent:chat.',
    `Merg și formele scurte de odinioară, după /agent: ${list(short)}.`,
  ].join('\n');
}

export function answerGreet(text, report, { tz = DEFAULT_TZ } = {}) {
  const f = fold(text);
  const thanks = /multumesc|mersi|merci|thanks|thank you|\bms\b/.test(f);
  const ack = /^(ok|okay|bine|clar|am inteles|inteleg|gata|in regula|da|super|perfect|bravo)[\s.!,]*$/.test(f.trim());
  if (thanks || ack) return `${thanks ? 'Cu plăcere!' : 'Bine.'} Dacă vrei să mă uit la ceva anume, spune-mi — de exemplu „ce s-a schimbat de ieri?” sau „ce proiecte semnalează radarul?”.`;
  const head = 'Salut! Sunt agentul AI al CRI Radar.';
  if (!report) return `${head} ${noReport()}`;
  const k = report.summary?.counts ?? {};
  const state = report.overall === 'PASS' ? 'totul trece' : report.overall === 'FAIL' ? `${n(k.FAIL ?? 0, 'eșec', 'eșecuri')} de rezolvat` : `${n((report.findings ?? []).length, 'lucru cere', 'lucruri cer')} atenție`;
  return `${head} La ultima verificare (${when(report.generatedAt, tz)}) ${state}. Întreabă-mă orice despre radar, în cuvintele tale — de exemplu „cum stă radarul?” sau „ce șanse are LAB?”.`;
}

/* ───────────────────────────── status, gates ───────────────────────────── */

export function answerStatus(report, { tz = DEFAULT_TZ } = {}) {
  if (!report) return noReport();
  const k = report.summary?.counts ?? {};
  const total = report.summary?.total ?? 0;
  const f = report.findings ?? [];
  const waiting = (k.UNKNOWN ?? 0) + (k.LEARNING ?? 0);
  const out = [];
  if (report.overall === 'PASS') out.push(`Totul e în regulă: trec ${k.PASS ?? 0} din ${n(total, 'poartă', 'porți')}${waiting ? `, iar ${waiting} încă nu au date sau învață` : ''}.`);
  else if (report.overall === 'FAIL') out.push(`Ceva nu merge: ${n(k.FAIL ?? 0, 'eșec', 'eșecuri')} și ${n(k.WARN ?? 0, 'atenționare', 'atenționări')}. Trec ${k.PASS ?? 0} din ${n(total, 'poartă', 'porți')}.`);
  else out.push(`Merge, dar ${n(f.length, 'lucru cere', 'lucruri cer')} atenție (${n(k.WARN ?? 0, 'atenționare', 'atenționări')}, niciun eșec). Trec ${k.PASS ?? 0} din ${n(total, 'poartă', 'porți')}.`);
  if (f.length) {
    out.push('', 'Ce cere atenție:');
    for (const x of f.slice(0, 5)) out.push(`- ${x.title}${x.value ? ` (${val(x.value)})` : ''}: ${short(x.evidence, tz)}.${x.remedy ? ` Ce ajută: ${short(x.remedy, tz)}.` : ''}`);
    if (f.length > 5) out.push(`- și încă ${f.length - 5}; întreabă „ce nu trece?” pentru toată lista.`);
  }
  const e = report.efficiency;
  const extra = [];
  if (e?.capability && isNum(e.effective)) extra.push(`Față de un desk profesional, eficiența efectivă este ${pct(e.effective)} (ținta de design ${pct(e.design)})${e.levers?.[0] ? `; cea mai mare pierdere vine din ${e.levers[0].label} (${ro(e.levers[0].points)} puncte)` : ''}.`);
  const id = report.identification?.short;
  const early = id?.tiers?.find((t) => t.id === 'EARLY');
  const erc = id?.tiers?.find((t) => t.id === 'ERC');
  if (early?.ready && isNum(early.lift)) extra.push(`Radarul alege bine: proiectele din banda TIMPURIU au crescut cu ${id.thresholdPct}% în ${id.horizonH} de ore de ${ro(early.lift, 2)} ori mai des decât restul pieței${erc && id.movers >= 20 && !(erc.recallPct > 0) ? ', dar verdictul strict (oportunitate peste 75) n-a prins încă nicio mișcare' : ''}.`);
  const se = report.selfEval;
  if (se?.ready) extra.push(se.comparable ? `Mă autoevaluez din ${n(se.runsScored, 'rulare', 'rulări')}: anticipez ${round2(se.skill) >= 0 ? 'cel puțin la fel de bine ca' : 'mai prost decât'} regula „ca data trecută” (skill ${ro(se.skill, 2)}).` : `Mă autoevaluez din ${n(se.runsScored, 'rulare', 'rulări')}; nimic nu s-a schimbat destul ca să mă compar cu regula „ca data trecută”, iar față de frecvența simplă skill-ul meu este ${ro(se.skillVsClimatology, 2)}.`);
  else if (se) extra.push(`Auto-evaluarea strânge date: ${se.runsScored} din ${se.minRuns} rulări notate.`);
  if (extra.length) out.push('', ...extra);
  out.push('', `Raportul este din ${when(report.generatedAt, tz)}${report.mode === 'demo' ? ' (demo, istoric simulat)' : ''}.`);
  return out.join('\n');
}

const round2 = (x) => Math.round((x ?? 0) * 100) / 100;

export function answerGates(report, { group = null, all = false, tz = DEFAULT_TZ } = {}) {
  if (!report) return noReport();
  const g = String(group ?? '').toLowerCase();
  const gates = (report.gates ?? []).filter((x) => !g || x.group === g);
  if (!gates.length) return `Nu am porți în grupul „${group}”. Grupurile sunt: ${list((report.groups ?? []).map((x) => x.id))}.`;
  const by = (s) => gates.filter((x) => x.status === s);
  const label = g ? (report.groups ?? []).find((x) => x.id === g)?.label ?? g : null;
  const waitingN = by('UNKNOWN').length + by('LEARNING').length;
  const out = [`Din ${n(gates.length, 'poartă', 'porți')}${label ? ` (${label})` : ''}: ${by('PASS').length} trec, ${by('WARN').length ? `${by('WARN').length} în atenționare` : 'niciuna în atenționare'}, ${by('FAIL').length ? `${by('FAIL').length} eșuate` : 'niciuna eșuată'}${waitingN ? `, ${waitingN} fără date sau încă în învățare` : ''}.`];
  const bad = [...by('FAIL'), ...by('WARN')];
  if (bad.length) out.push('', 'Nu trec:', ...bad.map((x) => `- ${x.title} (${x.id}${x.value ? `, ${val(x.value)}` : ''}): ${short(x.evidence, tz)}.`));
  const waiting = [...by('UNKNOWN'), ...by('LEARNING')];
  if (waiting.length) out.push('', `Fără verdict încă: ${list(waiting.map((x) => `${x.title} (${ST[x.status]})`))}.`);
  if (all) out.push('', 'Trec:', ...by('PASS').map((x) => `- ${x.title}${x.value ? ` — ${val(x.value)}` : ''}`));
  else if (by('PASS').length) out.push('', `Celelalte ${by('PASS').length} trec. Pentru lista completă, întreabă „arată toate porțile”; pentru una anume, „de ce …?”.`);
  out.push('', `Starea este din ${when(report.generatedAt, tz)}.`);
  return out.join('\n');
}

/* ───────────────────────────── what changed ───────────────────────────── */

const CODE_STATUS = { P: 'PASS', W: 'WARN', F: 'FAIL', U: 'UNKNOWN', L: 'LEARNING' };
/** How long an incident lasted, in words. */
const took = (h) => (!isNum(h) ? '' : h < 0.1 ? ', în câteva minute' : `, după ${ro(h, 1)} ${h === 1 ? 'oră' : 'ore'}`);
const windowLabel = (h) => (h === 1 ? 'În ultima oră' : h === 24 ? 'În ultimele 24 de ore' : h === 168 ? 'În ultima săptămână' : h % 24 === 0 ? `În ultimele ${n(h / 24, 'zi', 'zile')}` : `În ultimele ${n(h, 'oră', 'ore')}`);
const gatesLine = (c) => `${c?.PASS ?? 0} trecute, ${count(c?.WARN ?? 0, 'atenționare', 'atenționări', 'nicio atenționare')}, ${count(c?.FAIL ?? 0, 'eșec', 'eșecuri', 'niciun eșec')}`;

/**
 * What changed in a time window, from the memory: problems that appeared or cleared (and the commit
 * that cleared them), the gates at the start of the window and now, rules whose verdict moved, and
 * what the agent itself did.
 */
export function answerChanges(report, memory, { nowMs, hours = 24, tz = DEFAULT_TZ } = {}) {
  if (!report) return noReport();
  const h = isNum(hours) && hours > 0 ? hours : 24;
  const end = isNum(nowMs) ? nowMs : Date.parse(report.generatedAt);
  const since = end - h * H;
  const t = (iso) => Date.parse(iso ?? '');
  const incidents = memory?.incidents ?? [...(report.incidents?.open ?? []), ...(report.incidents?.resolved ?? [])];
  const opened = incidents.filter((i) => t(i.firstSeen) >= since).sort((a, b) => t(a.firstSeen) - t(b.firstSeen));
  const resolved = incidents.filter((i) => i.resolvedAt && t(i.resolvedAt) >= since).sort((a, b) => t(a.resolvedAt) - t(b.resolvedAt));
  const history = (memory?.reports ?? report.history ?? []).filter((x) => Number.isFinite(t(x.at)));
  const checks = history.filter((x) => t(x.at) >= since).length;
  const start = [...history].reverse().find((x) => t(x.at) <= since) ?? history.find((x) => t(x.at) > since) ?? null;
  const out = [`${windowLabel(h)} (de la ${when(since, tz)}):`];
  const now = report.summary?.counts ?? {};
  if (start && start.counts) {
    const same = ['PASS', 'WARN', 'FAIL'].every((k) => (start.counts[k] ?? 0) === (now[k] ?? 0));
    out.push(same ? `- Porțile sunt ca la început: ${gatesLine(now)}.` : `- Porțile: la început ${gatesLine(start.counts)}; acum ${gatesLine(now)}.`);
  } else out.push(`- Porțile, acum: ${gatesLine(now)}.`);
  if (resolved.length) for (const i of resolved) out.push(`- S-a rezolvat „${i.title}”${i.resolvedBy?.sha ? `, prin commitul ${String(i.resolvedBy.sha).slice(0, 7)} („${cut(i.resolvedBy.message, 80)}”)` : ', de la sine'}${took(i.durationHours)}.`);
  if (opened.length) for (const i of opened) out.push(`- A apărut „${i.title}” (${ST[i.worst] ?? STATUS_RO[i.worst] ?? i.worst}), pe ${when(i.firstSeen, tz)}${i.status === 'resolved' || i.resolvedAt ? '; s-a rezolvat între timp' : ''}. ${short(i.evidence, tz)}.`);
  const flips = [];
  for (const [id, pts] of Object.entries(memory?.ruleHistory ?? {})) {
    const last = pts?.at(-1);
    const first = [...(pts ?? [])].reverse().find((p) => p[0] <= since) ?? null;
    if (last && first && last[1] !== first[1]) flips.push(`${id} a trecut din „${ST[CODE_STATUS[first[1]]] ?? first[1]}” în „${ST[CODE_STATUS[last[1]]] ?? last[1]}”`);
  }
  if (flips.length) out.push(`- Reguli: ${list(flips)}.`);
  const acts = (memory?.actions ?? []).filter((a) => t(a.at) >= since && a.kind === 'dispatch');
  if (acts.length) {
    const by = {};
    for (const a of acts) by[a.workflow] = (by[a.workflow] ?? 0) + 1;
    out.push(`- Eu am pornit ${list(Object.entries(by).map(([wf, c]) => `${wf} ${times(c)}`))}, ca să completez cadența promisă.`);
  }
  if (!resolved.length && !opened.length && !flips.length) out.push('- Nicio problemă nouă și niciuna rezolvată.');
  out.push('', `Am făcut ${n(checks, 'verificare', 'verificări')} în acest interval; ultima pe ${when(report.generatedAt, tz)}.${(report.findings ?? []).length ? ' Pentru cauzele a ce cere atenție acum, întreabă „de ce?”.' : ''}`);
  return out.join('\n');
}

/* ───────────────────────────── starting a workflow ───────────────────────────── */

/**
 * „Pornește o scanare”: the conversation starts nothing (it answers, and opens a pull request when
 * asked for code); what the agent starts by itself, within its limits, and how to start one by hand.
 */
export function answerRun({ file = null, name = null, heal = {}, gate = null }) {
  const out = ['Din conversație nu pornesc workflow-uri: aici răspund și, când îmi ceri cod, deschid un pull request.'];
  const auto = [];
  if (heal?.enabled !== false) {
    if (heal?.scan?.enabled !== false) auto.push(`scanarea completă (cel mult ${n(heal?.scan?.maxPerDay ?? 4, 'dată', 'ori')} pe zi, la cel puțin ${ro(heal?.scan?.minGapHours ?? 4.5, 1)} ore una de alta)`);
    if (heal?.pulse?.enabled !== false) auto.push(`pulsul (cel mult ${n(heal?.pulse?.maxPerDay ?? 8, 'dată', 'ori')} pe zi, la cel puțin ${ro(heal?.pulse?.minGapHours ?? 2, 1)} ore unul de altul)`);
  }
  if (auto.length) out.push(`Singur pornesc ${list(auto)}, doar când GitHub sare programările și doar cât cota lunară folosită e sub ${ro(heal?.maxQuotaShare ?? 85, 0)}%.`);
  if (file) out.push('', `Dacă vrei o rulare acum: pe GitHub, Actions → „${name ?? file}” → Run workflow; din Termux, cu GitHub CLI: gh workflow run ${file}.`);
  if (gate) out.push(`Starea de acum: ${gate.title} — ${ST[gate.status] ?? gate.status}${gate.value ? ` (${gate.value})` : ''}.`);
  return out.join('\n');
}

/* ───────────────────────────── the radar's signals ───────────────────────────── */

const byOpportunity = (a, b) => (b.opportunity ?? -1) - (a.opportunity ?? -1);

/** The projects the radar points at now: the exact answers, the early candidates, the closest. */
export function answerSignals(rows, { limit = 5, all = false } = {}) {
  const items = (rows ?? []).filter((r) => r.symbol && r.valid !== 'R');
  if (!items.length) return 'Nu am încă lista proiectelor: o aduce prima scanare salvată pe ramura cri-state (în Termux, npm run agent:sync o aduce local).';
  const k = all ? 15 : limit;
  const line = (r) =>
    `- ${r.symbol}${r.name && r.name !== r.symbol ? ` (${r.name})` : ''}: stadiul ${r.stage ?? '—'}, oportunitate ${ro(r.opportunity, 1)}, risc ${ro(r.risk, 0)}${isNum(r.families) && r.changes ? `, ${n(r.changes, 'schimbare', 'schimbări')} în ${n(r.families, 'familie', 'familii')}` : ''}${isNum(r.marketCap) ? `, capitalizare ${ro(r.marketCap / 1e6, 1)} milioane $` : ''}${r.valid === 'P' ? '; validarea e încă în curs' : ''}.`;
  const exact = items.filter((r) => r.answers).sort(byOpportunity);
  const early = items.filter((r) => r.early && !r.answers).sort(byOpportunity);
  const out = [];
  if (exact.length) out.push(`${n(exact.length, 'proiect răspunde', 'proiecte răspund')} exact la întrebarea radarului — Stage 1–2, oportunitate peste 75, risc sub 60 și mai multe schimbări deodată:`, ...exact.slice(0, k).map(line));
  if (early.length) out.push(...(out.length ? [''] : []), `${n(early.length, 'candidat', 'candidați')} de research timpuriu (aceleași trei condiții, dar schimbările nu sunt încă simultane):`, ...early.slice(0, k).map(line));
  if (!exact.length && !early.length) {
    const near = items.filter((r) => r.band === 'EARLY' && [1, 2].includes(r.stage) && isNum(r.opportunity)).sort(byOpportunity).slice(0, k);
    out.push('Acum niciun proiect nu îndeplinește verdictul strict (Stage 1–2, oportunitate peste 75, risc sub 60).');
    if (near.length) out.push('', 'Cele mai apropiate, din banda TIMPURIU și stadiile 1–2:', ...near.map(line));
  }
  const more = exact.length + early.length > k && !all;
  out.push('', `E o listă de cercetat, nu de cumpărat: pe dashboard fiecare proiect are dovezile și riscurile care îl pot invalida.${more ? ' Pentru toată lista, întreabă „toate semnalele”.' : ''}`);
  return out.join('\n');
}

/* ───────────────────────────── identification, rules, learning ───────────────────────────── */

function tierLine(t, e) {
  if (!t?.n) return null;
  if (!t.ready) return `- ${t.label}: doar ${n(t.n, 'observație', 'observații')}${t.hits ? `, ${t.hits} cu creștere` : ', nicio creștere'}${isNum(t.medianEndPct) ? `, rezultat median ${pct(t.medianEndPct)}` : ''} — eșantion prea mic pentru un verdict.`;
  const sure = isNum(t.liftLo) && t.liftLo > 1 ? `sigur peste piață (limita de jos ${ro(t.liftLo, 2)})` : isNum(t.liftHi) && t.liftHi < 1 ? `sigur sub piață (limita de sus ${ro(t.liftHi, 2)})` : 'încă nesigur';
  return `- ${t.label}: ${pct(t.ratePct)} din ${n(t.n, 'observație', 'observații')}, adică de ${ro(t.lift, 2)} ori rata pieței, ${sure}; a prins ${pct(t.recallPct)} din mișcări; rezultat median ${pct(t.medianEndPct)}.`;
}

export function answerEfficiency(report, { why = false } = {}) {
  if (!report) return noReport();
  const ids = report.identification;
  if (!ids) return 'Nu pot măsura încă eficiența identificării: îmi lipsește istoricul scanărilor (discovery.json de pe ramura cri-state).';
  const out = [];
  // „De ce?” after the efficiency: how it is measured, before the table again.
  if (why) out.push('Cum măsor: pentru fiecare proiect și fiecare scanare iau verdictul publicat atunci și mă uit doar la prețurile din scanările de după, apoi compar fiecare nivel de semnal cu tot universul din aceleași scanări. Când „de N ori rata pieței” e peste 1, nivelul alege mai bine decât întâmplarea; când și limita de jos a intervalului de 90% e peste 1, diferența nu mai poate fi pusă pe seama norocului.', '');
  const s = ids.short;
  if (s?.observations) {
    out.push(`Am verificat ce a făcut prețul după fiecare semnal publicat de radar: ${n(s.observations, 'observație', 'observații')} din ${n(s.scans, 'scanare', 'scanări')} (${n(s.assets, 'proiect', 'proiecte')}). În tot universul, ${pct(s.baseRatePct)} au crescut cu cel puțin ${s.thresholdPct}% în ${s.horizonH} de ore.`, '');
    for (const id of ['IGNORE', 'WATCH', 'EARLY', 'CONFIRMED', 'STAGE0', 'STAGE1', 'STAGE2', 'STAGE3', 'ERC', 'EARLY_STAGE12']) {
      const line = tierLine(s.tiers.find((t) => t.id === id), s);
      if (line) out.push(line);
    }
  } else out.push(`Încă nu am observații cu orizontul de ${s?.horizonH ?? 72} de ore încheiat; primul verdict vine după trei zile de scanări salvate.`);
  const m = ids.medium;
  if (m?.observations) {
    const early = m.tiers.find((t) => t.id === 'EARLY');
    out.push('', `Pe fereastra lungă (${m.thresholdPct}% în ${m.horizonH / 24} zile): ${n(m.observations, 'observație', 'observații')}, rata pieței ${pct(m.baseRatePct)}${early?.ready ? `, banda TIMPURIU de ${ro(early.lift, 2)} ori` : ''}.`);
  }
  const verdict = (report.rules?.results ?? []).filter((r) => r.area === 'identificare');
  if (verdict.length) {
    const failing = verdict.filter((r) => r.status === 'WARN' || r.status === 'FAIL');
    out.push('', failing.length ? `După regulile mele: ${list(verdict.filter((r) => r.status === 'PASS').map((r) => r.id))} ${verdict.filter((r) => r.status === 'PASS').length === 1 ? 'trece' : 'trec'}; ${list(failing.map((r) => `${r.id} (${r.title.toLowerCase()})`))} ${failing.length === 1 ? 'nu trece' : 'nu trec'}.` : `După regulile mele, ${list(verdict.map((r) => r.id))}: nicio problemă.`);
  }
  const rec = (report.rules?.recommendations ?? []).filter((r) => r.id.startsWith('ID-'));
  for (const r of rec.slice(0, 2)) out.push(`Recomandarea mea pentru ${r.id}: ${plain(r.text)}`);
  return out.join('\n');
}

const AREA_RO = Object.fromEntries(AREAS.map((a) => [a.id, a.label]));
const TREND = { PASS: 'a trecut', WARN: 'a fost în atenționare', FAIL: 'a fost eșuată', LEARNING: 'a fost în învățare', UNKNOWN: 'a fost fără date' };

/** How a rule's verdict went over its recent runs, in a sentence. */
function trendLine(t) {
  const seen = Object.entries(t.by).filter(([, c]) => c);
  if (t.recent === 1) return `La singura rulare de până acum ${TREND[seen[0]?.[0]] ?? 'nu a avut verdict'}.`;
  if (seen.length === 1) return `În ultimele ${n(t.recent, 'rulare', 'rulări')} ${TREND[seen[0][0]]} de fiecare dată.`;
  return `În ultimele ${n(t.recent, 'rulare', 'rulări')}: ${list(seen.map(([s, c]) => `${TREND[s]} ${times(c)}`))}.`;
}

export function answerRules(report, { ruleId = null, all = false, tz = DEFAULT_TZ } = {}) {
  if (!report) return noReport();
  const r = report.rules;
  if (!r?.results?.length) return 'Regulile fundamentale nu sunt încă în raport; le încarc la fiecare rulare din agent/knowledge/rules.json.';
  if (ruleId) {
    const x = r.results.find((y) => y.id === String(ruleId).toUpperCase());
    if (!x) return `Nu am o regulă „${ruleId}”. Regulile mele sunt ${list(r.results.map((y) => y.id))}.`;
    const t = x.trend;
    return [
      `Regula ${x.id}, „${x.title}”: ${plain(x.rule)}`,
      x.why ? `De ce contează: ${plain(x.why)}` : null,
      '',
      `Acum ${x.status === 'PASS' ? 'trece' : `este ${ST[x.status] ?? x.status}`}${x.value ? ` (${val(x.value)})` : ''}. ${txt(x.evidence, tz)}`,
      x.recommendation && x.status !== 'PASS' ? `Recomandarea mea: ${plain(x.recommendation)}` : null,
      t?.recent ? `${trendLine(t)}${t.changedAt ? ` Verdictul s-a schimbat ultima dată pe ${when(t.changedAt, tz)}.` : ''}` : null,
    ]
      .filter((x) => x !== null)
      .join('\n');
  }
  const bad = r.results.filter((x) => x.status === 'WARN' || x.status === 'FAIL');
  const out = [`Am ${n(r.total, 'regulă fundamentală', 'reguli fundamentale')} (versiunea ${r.version}): ${r.counts.PASS} trec, ${r.counts.WARN} în atenționare, ${r.counts.FAIL} eșuate, ${r.counts.LEARNING} încă în învățare${r.counts.UNKNOWN ? `, ${r.counts.UNKNOWN} fără date` : ''}.`];
  if (all) {
    for (const a of [...new Set(r.results.map((x) => x.area))]) {
      out.push('', `${AREA_RO[a] ?? a}:`, ...r.results.filter((x) => x.area === a).map((x) => `- ${x.id} ${x.title}: ${ST[x.status] ?? x.status}${x.value ? ` (${val(x.value)})` : ''}.`));
    }
    out.push('', 'Pentru una anume, întreabă de exemplu „ce spune regula ID-5?”. Pragurile le schimbi doar tu, printr-un commit în agent/knowledge/rules.json.');
    return out.join('\n');
  }
  if (bad.length) out.push('', 'Nu trec:', ...bad.map((x) => `- ${x.id} ${x.title}: ${short(x.evidence, tz)}.`));
  const learning = r.results.filter((x) => x.status === 'LEARNING');
  if (learning.length) out.push('', `Așteaptă date: ${list(learning.map((x) => x.id))}.`);
  out.push('', 'Întreabă-mă de oricare, de exemplu „ce spune regula ID-5?”. Pragurile le schimbi doar tu, printr-un commit în agent/knowledge/rules.json.');
  return out.join('\n');
}

export function answerLearning(report, { tz = DEFAULT_TZ } = {}) {
  if (!report) return noReport();
  const se = report.selfEval;
  const l = report.learning ?? {};
  const out = [];
  if (se) {
    if (!se.runsScored) out.push(`Încă nu mi-am putut nota predicțiile: verdictul despre cât de bine anticipez vine după ${se.minRuns} de rulări.`);
    else {
      out.push(`La fiecare rulare prezic care porți vor cere atenție la rularea următoare și apoi îmi notez predicțiile. Până acum: ${n(se.runsScored, 'rulare notată', 'rulări notate')}, ${n(se.predictions, 'predicție', 'predicții')}.`);
      out.push(`Scorul meu Brier este ${ro(se.brier, 4)}, față de ${ro(se.brierPersistence, 4)} pentru regula naivă „ca data trecută” și ${ro(se.brierClimatology, 4)} pentru frecvența simplă (mai mic e mai bine).`);
      if (se.comparable) out.push(round2(se.skill) >= 0 ? `Anticipez cel puțin la fel de bine ca regula naivă (skill ${ro(se.skill, 2)}, pe ${n(se.changes, 'schimbare de stare', 'schimbări de stare')}).` : `Deocamdată anticipez mai prost decât regula naivă (skill ${ro(se.skill, 2)}); învăț tranzițiile porților pe o fereastră mai lungă.`);
      else out.push(`Nu s-a schimbat destul (${n(se.changes, 'schimbare de stare', 'schimbări de stare')}) ca regula naivă să poată fi bătută, așa că mă compar cu frecvența simplă: skill ${ro(se.skillVsClimatology, 2)}.`);
      if (se.curve?.length >= 2) out.push(`Eroarea mea pe ferestre de ${se.curve[0].runs} rulări: ${list(se.curve.map((c) => ro(c.brier, 4)))} — ${isNum(se.brierTrend) && se.brierTrend <= 0 ? 'scade, deci învăț' : 'nu scade încă'}.`);
      if (!se.ready) out.push(`Verdictul oficial vine după ${se.minRuns} de rulări notate.`);
    }
    if (se.coverage?.n) out.push(`Normele pe care le-am învățat acoperă ${pct(se.coverage.insidePct)} din valorile noi (ținta ${pct(se.coverage.targetPct, 0)}).`);
    if (se.nextRun?.watch?.length) out.push(`La rularea următoare s-ar putea să ceară atenție: ${list(se.nextRun.watch.map((w) => `${w.id} (${pct(w.pct, 0)})`))}.`);
    if (se.coder?.proposals) out.push(`Din propunerile mele de cod, ai acceptat ${se.coder.merged} din ${se.coder.proposals}${se.coder.open ? ` (${se.coder.open} încă ${se.coder.open === 1 ? 'deschisă' : 'deschise'})` : ''}.`);
  }
  out.push('', `Din istoric am învățat ${n(l.normsLearned ?? 0, 'normă', 'norme')} din ${n(l.metrics ?? 0, 'metrică', 'metrici')}, am ${n(l.incidents?.resolved ?? 0, 'incident rezolvat', 'incidente rezolvate')} și ${n(l.incidents?.open ?? 0, 'incident deschis', 'incidente deschise')}, plus ${n(l.fixes ?? 0, 'reparație reținută', 'reparații reținute')} (commitul care a închis fiecare incident). Rulez din ${when(l.since, tz)}.`);
  const res = report.incidents?.resolved ?? [];
  if (res.length) out.push('', 'Lecții recente:', ...res.slice(0, 4).map((i) => `- ${i.title}: ${i.resolvedBy?.sha ? `rezolvat de commitul ${i.resolvedBy.sha.slice(0, 7)} („${cut(i.resolvedBy.message, 80)}”)` : 's-a rezolvat singur'}${isNum(i.durationHours) ? ` după ${ro(i.durationHours, 1)} ore` : ''}.`));
  return out.join('\n');
}

/* ───────────────────────────── forecast ───────────────────────────── */

const findProject = (rows, q) => {
  const up = String(q ?? '').toUpperCase();
  return (rows ?? []).filter((r) => String(r.symbol ?? '').toUpperCase() === up || String(r.name ?? '').toUpperCase() === up);
};

export function answerForecast(rows, forecast, symbol, { all = false, why = false } = {}) {
  const q = String(symbol ?? '').trim();
  if (!q) return answerForecastTop(rows, forecast, { limit: all ? 15 : 5 });
  const up = q.toUpperCase();
  const hits = findProject(rows, up);
  const out = [];
  // „De ce?” after a forecast: where the number comes from, before the number again.
  if (why && hits.some((r) => isNum(r.fc100))) {
    const b = forecast?.baseRates?.find((x) => x.multiple === 100);
    out.push(`De unde vine cifra: pornesc de la rata de bază pentru o zi oarecare — cât de des un proiect mic urmărit a ajuns la 100× în 12 luni, socotit doar din zilele din care mișcarea mai era accesibilă (${pct(b?.pct, 2)}). Apoi o ajustez după amprentă: cât de des stau amprentele câștigătorilor confirmați (măsurate din zilele lor accesibile, fără date din viitor) în jurul proiectului, față de cât de des stă tot universul de azi. Ajustarea e trasă spre 1 cât timp câștigătorii sunt puțini, are un plafon de ×25 și se oprește singură dacă amprenta nu bate întâmplarea în afara eșantionului. Peste 1 înseamnă că seamănă cu ei mai mult decât un proiect oarecare; nu știu nimic despre viitorul lui în afara acestor asemănări.`, '');
  }
  const winner = (forecast?.winners ?? []).find((w) => String(w.symbol).toUpperCase() === up);
  const dd = isNum(winner?.drawdownNowPct) ? Math.abs(winner.drawdownNowPct) : null;
  if (winner) out.push(`${winner.symbol} este unul dintre câștigătorii din care învăț: a crescut de ${ro(winner.multiple, 1)} ori de la minimul din ${day(winner.low?.at)} până la vârful din ${day(winner.peak?.at)}${dd !== null ? `, iar acum este cu ${pct(dd, dd >= 99.5 ? 1 : 0)} sub vârf` : ''}.`);
  if (!hits.length) {
    out.push(`${winner ? 'Nu este însă' : `${q} nu este`} în universul cercetat la ultima scanare, deci nu are o prognoză acum.`);
    return out.join('\n');
  }
  const b100 = forecast?.baseRates?.find((b) => b.multiple === 100);
  const b20 = forecast?.baseRates?.find((b) => b.multiple === 20);
  for (const r of hits.slice(0, 2)) {
    if (out.length) out.push('');
    const about = [r.name && String(r.name).toUpperCase() !== String(r.symbol).toUpperCase() ? r.name : null, r.chain].filter(Boolean).join(', ');
    out.push(`${r.symbol}${about ? ` (${about})` : ''}: capitalizare ${isNum(r.marketCap) ? `${ro(r.marketCap / 1e6, 1)} milioane $` : 'necunoscută'}, stadiul ${r.stage ?? '—'}, oportunitate ${ro(r.opportunity, 1)}, risc ${ro(r.risk, 0)}.`);
    if (isNum(r.fc100)) out.push(`Probabilitatea ca prețul să ajungă la cel puțin 100 de ori prețul de azi în următoarele 12 luni este ${pct(r.fc100, 2)}${isNum(r.fcLift) ? `, de ${ro(r.fcLift, 2)} ori rata de bază (${pct(b100?.pct, 2)})` : ''}. Pentru 20 de ori: ${pct(r.fc20, 2)} (bază ${pct(b20?.pct, 2)}).`);
    else out.push(r.valid === 'R' ? 'Nu are prognoză: proiectul a fost respins de poarta de validitate.' : 'Nu are încă prognoză: proiectul nu a trecut de poarta de validitate.');
    const top = (forecast?.top ?? []).find((t) => t.key === r.key);
    if (top?.nearest?.length) out.push(`Seamănă cel mai mult cu ${list(top.nearest.slice(0, 2).map((x) => `${x.symbol || x.name} (a crescut de ${ro(x.multiple, 1)} ori; similaritate ${pct(x.similarity, 0)})`))}.`);
  }
  out.push('', 'O probabilitate mică rămâne mică: prognoza ordonează ce merită cercetat, nu promite un rezultat.');
  return out.join('\n');
}

export function answerForecastTop(rows, forecast, { limit = 5 } = {}) {
  const top = (forecast?.top ?? []).slice(0, limit);
  const b100 = forecast?.baseRates?.find((b) => b.multiple === 100);
  if (!top.length) return 'Nu am încă o listă de prognoze: apare după prima scanare cu modulul de prognoză.';
  const p = (t, k) => t.targets?.[k]?.pct;
  return [
    `Cele mai mari probabilități acum, doar proiecte verificate (rata de bază pentru 100× este ${pct(b100?.pct, 2)} pentru o zi oarecare):`,
    ...top.map((t, i) => `${i + 1}. ${t.symbol || t.name}: ${pct(p(t, '100'), 2)} pentru 100×, ${pct(p(t, '20'), 2)} pentru 20×${t.nearest?.[0] ? `; seamănă cu ${t.nearest[0].symbol || t.nearest[0].name}` : ''}.`),
    '',
    'Pentru un proiect anume, întreabă „ce șanse are SIMBOL?”. O probabilitate mică rămâne mică.',
  ].join('\n');
}

/* ───────────────────────────── diagnosis ───────────────────────────── */

function memoryLessons(memory, gateId, signature) {
  const inc = (memory?.incidents ?? []).filter((i) => i.gate === gateId);
  const fixes = [...(memory?.fixes?.[gateId] ?? []), ...(signature ? memory?.fixes?.[`sig:${signature}`] ?? [] : [])].filter((f) => f.sha || f.transient);
  return { inc, fixes };
}

export function diagnoseGate(report, memory, gateId, { tz = DEFAULT_TZ } = {}) {
  const g = (report?.gates ?? []).find((x) => x.id === gateId);
  if (!g) return null;
  const f = (report.findings ?? []).find((x) => x.id === gateId);
  const what = (report.gateCatalogue ?? []).find((c) => c.id === g.id)?.what;
  // The title is the gate's claim („Ultima scanare live a reușit”), so it is quoted.
  const out = [g.status === 'PASS' ? `„${g.title}” (${g.id}) trece acum${g.value ? ` (${val(g.value)})` : ''}.` : `„${g.title}” (${g.id}) este acum ${ST[g.status] ?? g.status}${g.value ? `: ${val(g.value)}` : ''}.`];
  if (what) out.push(`Ce verifică: ${plain(what)}`);
  out.push(`Ce am văzut: ${txt(g.evidence, tz)}`);
  if (g.remedy && g.status !== 'PASS') out.push(`Ce ajută: ${txt(g.remedy, tz)}`);
  const { inc, fixes } = memoryLessons(memory, g.id, g.signature);
  if (f?.lesson?.lastFix) out.push(`Din istoric: data trecută s-a rezolvat prin commitul ${String(f.lesson.lastFix.sha).slice(0, 7)} („${cut(f.lesson.lastFix.message, 100)}”).`);
  else if (fixes.some((x) => x.sha)) out.push(`Din istoric: s-a rezolvat înainte prin ${list(fixes.filter((x) => x.sha).slice(-2).map((x) => `${x.sha.slice(0, 7)} („${cut(x.message, 70)}”)`))}.`);
  if (inc.length > 1) out.push(`Am mai văzut problema de ${n(inc.length, 'dată', 'ori')}; prima dată pe ${when(inc[0].firstSeen, tz)}.`);
  else if (g.status !== 'PASS' && !inc.length) out.push('E prima dată când o văd.');
  if (g.link) out.push(`${/\/actions\/runs\//.test(g.link) ? 'Rularea' : 'Linkul'}: ${g.link}`);
  return out.join('\n');
}

const EVENT = { schedule: 'programată', push: 'la un push', workflow_dispatch: 'pornită manual sau de agent', workflow_run: 'după alt workflow', pull_request: 'la un pull request', issue_comment: 'la un comentariu', issues: 'la o problemă nouă' };

/**
 * A failed run, told step by step.
 * @param {{run:any, jobs:any[], annotations:any[], signature:any, memory:any, commits:any[], lastSuccess:any, tz?:string}} o
 */
export function diagnoseRun({ run, jobs = [], annotations = [], signature = null, memory = null, commits = [], lastSuccess = null, tz = DEFAULT_TZ }) {
  const out = [`Rularea ${run?.id ?? '—'} a workflow-ului ${run?.name ?? run?.file ?? '—'} (${EVENT[run?.event] ?? run?.event ?? '—'}, ${when(run?.createdAt, tz)}) ${conclusionRo(run?.conclusion)}.`];
  const failed = jobs.flatMap((j) => (j.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => `„${s.name}” (jobul ${j.name})`));
  out.push(failed.length ? `A căzut la pasul ${list(failed)}.` : jobs.length ? 'Niciun pas nu e marcat ca eșuat: rularea a fost anulată, a expirat sau încă rulează.' : 'Nu am putut citi joburile rulării.');
  const errs = annotations.filter((a) => a.level === 'failure' || a.level === 'error' || String(a.title ?? '').startsWith('gate:'));
  for (const a of errs.slice(0, 2)) out.push(`Mesajul: ${cut(txt(a.message, tz), 260)}${a.path && a.path !== '.github' ? ` (${a.path})` : ''}`);
  if (signature) {
    out.push(`Seamănă cu „${signature.cause}” (${signature.code}).${signature.remedy ? ` Ce ajută: ${txt(signature.remedy, tz)}` : ''}`);
    const fx = (memory?.fixes?.[`sig:${signature.code}`] ?? []).filter((x) => x.sha);
    if (fx.length) out.push(`Data trecută aceeași problemă s-a rezolvat prin commitul ${fx.at(-1).sha.slice(0, 7)} („${cut(fx.at(-1).message, 90)}”).`);
  }
  if (lastSuccess && commits.length) {
    out.push(`De la ultima rulare reușită (${when(lastSuccess.createdAt, tz)}) au intrat ${n(commits.length, 'commit', 'commituri')}; cel mai probabil vinovat este cel mai recent: ${String(commits[0].sha).slice(0, 7)} „${cut(commits[0].message, 90)}”.`);
    if (commits.length > 1) out.push(`Celelalte: ${list(commits.slice(1, 4).map((c) => `${String(c.sha).slice(0, 7)} („${cut(c.message, 60)}”)`))}.`);
  }
  if (run?.url) out.push(`Rularea: ${run.url}`);
  return out.join('\n');
}

/** Every open finding, most severe first — what is wrong and what helps. */
export function diagnoseAll(report, memory, { tz = DEFAULT_TZ, all = false } = {}) {
  if (!report) return noReport();
  const f = report.findings ?? [];
  if (!f.length) return 'Nu văd nicio problemă acum: nicio poartă nu e în atenționare sau eșec. Dacă te gândești la ceva anume, spune-mi ce — de exemplu „de ce a picat scanarea de azi?”.';
  const k = all ? f.length : 3;
  const out = [`Am găsit ${n(f.length, 'problemă', 'probleme')}, cea mai gravă prima:`];
  for (const x of f.slice(0, k)) out.push('', diagnoseGate(report, memory, x.id, { tz }) ?? `${x.title}: ${txt(x.evidence, tz)}`);
  if (f.length > k) out.push('', `Și încă ${f.length - k}: ${list(f.slice(k).map((x) => x.title))}. Pentru toate, cu detalii, întreabă „detalii”.`);
  return out.join('\n');
}

/* ───────────────────────────── free questions ───────────────────────────── */

/** Without a model: the documentation's passages that answer, in plain text, with their source. */
export function retrievalAnswer(question, passages) {
  if (!passages.length) return `Nu am găsit în documentație nimic despre „${cut(question, 120)}”. Încearcă alte cuvinte sau întreabă-mă „ce poți face?”.`;
  const out = ['Iată ce scrie în documentația proiectului despre asta:'];
  for (const p of passages.slice(0, 3)) out.push('', passage(plain(unwrap(p.text)), 700), `(din ${p.doc}, „${p.heading}”)`);
  return out.join('\n');
}

export function askPrompt(question, passages, facts) {
  return {
    system: 'Ești agentul AI al proiectului CRI Radar (cercetare crypto pe surse gratuite, fără tranzacționare) și vorbești cu proprietarul lui. Răspunzi în limba română, cu diacritice, la persoana întâi, în TEXT SIMPLU: propoziții scurte, fără Markdown (fără asteriscuri, diezi, tabele, blocuri de cod), cel mult o listă scurtă cu „- ”. Folosești DOAR CONTEXTUL dat (pasaje din documentație și faptele măsurate de tine). Dacă răspunsul nu este acolo, spui simplu că nu știi. Nu inventezi cifre, nu dai sfaturi de investiții, nu scrii linkuri.',
    prompt: `CONTEXT — pasaje din documentație:\n${passages.map((p, i) => `[${i + 1}] ${p.doc} › ${p.path || p.heading}\n${plain(unwrap(p.text))}`).join('\n\n')}\n\nCONTEXT — faptele mele (JSON):\n${JSON.stringify(facts)}\n\nÎNTREBAREA: ${question}\n\nRăspunsul, în text simplu (cel mult 180 de cuvinte):`,
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
  const unknown = numbersIn(t).filter((x) => !x.readings.some(has)).map((x) => x.token);
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

/** The pull request's description, in plain text like everything the agent writes. */
export function prBody({ task, author = null, model = null, changed = [], created = [], tests = null, rounds = 1, issue = null, problems = [] }) {
  return [
    CHAT_MARKER,
    `Sarcina${author ? `, cerută de @${author}` : ''}: ${task}`,
    '',
    `Fișiere: ${list(changed.map((p) => `${p}${created.includes(p) ? ' (nou)' : ''}`)) || '—'}.`,
    `Testele (npm test, rulate în jobul fără permisiuni de scriere): ${tests ? (tests.ok ? 'trec' : `nu trec încă — ${cut(tests.summary, 300)}`) : 'nerulate'}${rounds > 1 ? `, după ${n(rounds - 1, 'rundă', 'runde')} de reparare` : ''}.`,
    problems.length ? `Atenție: ${problems.join('; ')}.` : null,
    '',
    `Am scris codul cu un model deschis rulat local în runner${model ? ` (${model})` : ''}, gratuit, fără cont și fără cheie. CI rulează pe ramură. Revizuiește înainte de merge: eu nu fac merge și nu scriu niciodată în main.`,
    issue ? `Cerut în #${issue}.` : null,
  ]
    .filter((x) => x !== null)
    .join('\n');
}

/** The last lines of a test run that say what failed. */
export function testSummary(output) {
  const lines = String(output ?? '').split('\n');
  const fails = lines.filter((l) => /^\s*(not ok|✖|✗)\b|\bfailing\b|AssertionError|Error:/.test(l)).slice(0, 12);
  const tail = lines.filter((l) => /^ℹ (tests|pass|fail)\b|^# (tests|pass|fail)\b/.test(l)).slice(-3);
  return [...fails, ...tail].join('\n').slice(0, 2000) || lines.slice(-15).join('\n').slice(0, 2000);
}
