/**
 * QUALITY GATES — every check the project relies on, in one catalogue, each evaluated from what the
 * agent observed. This is the list the README publishes and the dashboard's "Agent AI" screen shows.
 *
 * Groups:
 *   cod       — the CI suite on every push (syntax, architecture rules, every layer's tests, the
 *               offline DEMO scan and site build)
 *   rulare    — every live scan (completion, contract, sources, quotas, validity gate, forecast,
 *               duration, universe, state, deployed site, freshness, secrets)
 *   cadenta   — the schedule GitHub actually delivered, workflows enabled, repository activity
 *   periodic  — the weekly source probe and the monthly label refresh
 *   model     — calibration of the ≥100× forecast and the signal track record, learned over time
 *   agent     — the agent's own memory and narrator
 *
 * Status vocabulary: PASS · WARN · FAIL · UNKNOWN (nothing observed — never read as bad) · LEARNING
 * (observed, but the norm it is judged against still has too few points).
 *
 * Pure: every evaluator is a function of the observations, the learned norms and `nowMs`.
 */
import { observedCadence } from './cadence.js';
import { assess } from './norms.js';
import { classify } from './signatures.js';
import { DAY_MS, HOUR_MS, isNum, round, toMs } from './stats.js';

export const STATUS = Object.freeze({ PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN', LEARNING: 'LEARNING' });
export const STATUS_RO = Object.freeze({ PASS: 'trecut', WARN: 'atenționare', FAIL: 'eșuat', UNKNOWN: 'necunoscut', LEARNING: 'în învățare' });
export const GROUPS = Object.freeze([
  { id: 'cod', label: 'Cod — CI la fiecare push (Node 22 și 24)' },
  { id: 'rulare', label: 'Rulare — fiecare scanare live' },
  { id: 'cadenta', label: 'Cadență și programare' },
  { id: 'periodic', label: 'Verificări periodice' },
  { id: 'model', label: 'Model și învățare' },
  { id: 'agent', label: 'Agentul AI' },
]);

/**
 * The catalogue. `severity` is the weight of a FAIL (a WARN is always a warning); `ci` names the
 * groups of the CI gate report (scripts/gate-reporter.js) a code gate is read from.
 */
export const GATES = Object.freeze([
  { id: 'ci.run', group: 'cod', severity: 'critical', title: 'CI verde pe ultimul commit din main', what: 'Suita completă rulează pe Node 22 și 24 la fiecare push.' },
  { id: 'ci.syntax', group: 'cod', severity: 'critical', ci: ['syntax'], title: 'Sintaxă validă în toate fișierele JS', what: 'node --check pe src, web, scripts, test și agent.' },
  { id: 'ci.arch', group: 'cod', severity: 'critical', ci: ['arch.layers', 'arch.deterministic', 'arch.parity', 'arch.workflows', 'arch.other'], title: 'Arhitectură hexagonală respectată', what: 'Domeniul pur și determinist, aplicația doar spre domeniu și porturi, simulatorul cu aceeași suprafață ca adaptoarele reale, workflow-uri fără grup de concurență comun.' },
  { id: 'ci.free', group: 'cod', severity: 'critical', ci: ['arch.free'], title: 'Doar surse gratuite: hosturi aprobate, niciun abonament', what: 'Fiecare URL din adaptoare este pe lista aprobată; hosturile cu abonament (CoinGlass API, Dune API, X API, CoinGecko Pro…) sunt interzise.' },
  { id: 'ci.research', group: 'cod', severity: 'critical', ci: ['arch.research'], title: 'Exclusiv research: niciun endpoint de ordine sau retragere', what: 'Niciun endpoint de tranzacționare nu există în cod, nici nefolosit.' },
  { id: 'ci.domain', group: 'cod', severity: 'serious', ci: ['domain'], title: 'Testele de domeniu', what: 'Motoarele de scor, validare, prognoză, risc, stadii, bugete.' },
  { id: 'ci.application', group: 'cod', severity: 'serious', ci: ['application'], title: 'Testele de aplicație și end-to-end', what: 'Cazurile de utilizare și scanări complete pe piața simulată, zile la rând.' },
  { id: 'ci.adapters', group: 'cod', severity: 'serious', ci: ['adapters', 'scripts'], title: 'Testele de adaptoare și scripturi', what: 'Clientul HTTP (limite, circuit, cote), furnizorii, persistența, sonda.' },
  { id: 'ci.web', group: 'cod', severity: 'serious', ci: ['web'], title: 'Testele de interfață', what: 'Fiecare ecran randat din contract, fără valori lipsă scăpate în pagină și cu escaping corect.' },
  { id: 'ci.agent', group: 'cod', severity: 'serious', ci: ['agent'], title: 'Testele agentului AI', what: 'Porțile, normele, cadența, calibrarea, memoria și garda narațiunii.' },
  { id: 'ci.demo', group: 'cod', severity: 'serious', step: /Offline DEMO scan/i, title: 'Scanare DEMO offline, contract valid, site construit', what: 'Simulare de 10 zile, validare de schemă, dist/ cu latest.json și universe.json.' },
  { id: 'ci.pulse', group: 'cod', severity: 'warning', step: /pulse runs on top/i, title: 'Pulsul păstrează contractul', what: 'Pulsul rescrie snapshot-ul fără să încalce schema.' },
  { id: 'ci.labels', group: 'cod', severity: 'warning', step: /label dataset/i, title: 'Setul de etichete on-chain este prezent și clasifică', what: 'eth-labels (MIT) compactat în repo și verificat.' },

  { id: 'scan.run', group: 'rulare', severity: 'critical', title: 'Ultima scanare live a reușit', what: 'Workflow-ul „Scan & deploy” s-a încheiat cu succes, fără republicarea snapshot-ului vechi.' },
  { id: 'scan.contract', group: 'rulare', severity: 'critical', step: /Validate the published contract/i, title: 'Contractul publicat respectă schema', what: 'data/latest.json validat contra schema/latest.schema.json înainte de publicare.' },
  { id: 'scan.sources', group: 'rulare', severity: 'critical', title: 'Sursele obligatorii au răspuns', what: 'Universul CoinGecko și lumânările 1D/4H.' },
  { id: 'scan.providers', group: 'rulare', severity: 'warning', title: 'Furnizorii gratuiți răspund', what: 'Eșecuri și rata de succes istorică pe fiecare furnizor configurat.' },
  { id: 'scan.quota', group: 'rulare', severity: 'serious', title: 'Bugetele planurilor gratuite', what: 'Consumul lunar proiectat sub 80% pe fiecare plan; poarta oprește furnizorul înainte de limită.' },
  { id: 'scan.validity', group: 'rulare', severity: 'critical', title: 'Poarta de validitate aplicată', what: 'Fiecare proiect eligibil are verdict, iar în listele CRI nu apare niciun proiect respins.' },
  { id: 'scan.forecast', group: 'rulare', severity: 'serious', title: 'Prognoza ≥100×: listă de învățare și rată de bază', what: 'Câștigători confirmați din istoric, rată de bază plauzibilă, amprentă măsurată la minim (fără date din viitor).' },
  { id: 'scan.duration', group: 'rulare', severity: 'warning', title: 'Durata scanării în normă', what: 'Sub limita runtime.maxMinutes și în norma învățată din rulările anterioare.' },
  { id: 'scan.universe', group: 'rulare', severity: 'warning', title: 'Universul în normă', what: 'Top 1000 CoinGecko complet; numărul de proiecte eligibile fără prăbușiri față de normă.' },
  { id: 'scan.state', group: 'rulare', severity: 'serious', title: 'Starea cercetării salvată', what: 'Ramura cri-state conține snapshot-ul ultimei scanări reușite.' },
  { id: 'scan.pages', group: 'rulare', severity: 'serious', title: 'Site-ul publică ultimul snapshot', what: 'GitHub Pages servește aceeași rulare ca ramura de stare.' },
  { id: 'scan.freshness', group: 'rulare', severity: 'serious', title: 'Prospețimea datelor', what: 'Vârsta snapshot-ului față de cadența promisă.' },
  { id: 'scan.secrets', group: 'rulare', severity: 'critical', title: 'Nicio cheie în fișierele publicate', what: 'Snapshot-ul, rezumatul, tabelul orizontului și raportul agentului nu conțin chei sau URL-uri cu cheie.' },

  { id: 'cad.scan', group: 'cadenta', severity: 'serious', role: 'scan', title: 'Cadența scanării complete', what: 'Rulări efective pe zi față de cron (fereastră de 7 zile).' },
  { id: 'cad.pulse', group: 'cadenta', severity: 'warning', role: 'pulse', title: 'Cadența pulsului', what: 'Rulări efective pe zi față de cron; pulsul este „best effort” prin design.' },
  { id: 'cad.active', group: 'cadenta', severity: 'critical', title: 'Toate workflow-urile sunt active', what: 'Niciun workflow dezactivat manual sau pentru inactivitate.' },
  { id: 'cad.inactivity', group: 'cadenta', severity: 'critical', title: 'Activitate în repository', what: 'GitHub oprește programările unui repository public după 60 de zile fără activitate.' },

  { id: 'per.probe', group: 'periodic', severity: 'serious', role: 'probe', title: 'Sonda săptămânală a surselor gratuite', what: 'Un apel mic pe fiecare furnizor; eșuează doar la o sursă stricată.' },
  { id: 'per.labels', group: 'periodic', severity: 'warning', role: 'labels', title: 'Actualizarea lunară a etichetelor on-chain', what: 'Reconstruire din eth-labels și pull request când setul s-a schimbat.' },

  { id: 'model.calibration', group: 'model', severity: 'warning', title: 'Calibrarea prognozei ≥100× / ≥20×', what: 'Câștigători observați față de câți au fost prognozați, pe cohorte săptămânale; Brier la scadență.' },
  { id: 'model.trackrecord', group: 'model', severity: 'warning', title: 'Track record-ul semnalelor', what: 'Rezultatul semnalelor la scadențele de 7/14/30 de zile.' },

  { id: 'agent.memory', group: 'agent', severity: 'warning', title: 'Memoria agentului', what: 'Istoricul învățat: norme, incidente, remedieri, registrul prognozelor.' },
  { id: 'agent.narrator', group: 'agent', severity: 'warning', title: 'Narațiunea AI (model deschis local)', what: 'Rezumatul scris de un model deschis rulat local în runner, verificat cifră cu cifră; altfel șablonul determinist.' },
]);

const OK_PROVIDER = new Set(['OK', 'NOT_CONFIGURED', 'DISABLED', 'SKIPPED', 'BENIGN']);
const pctTxt = (x, d = 0) => (isNum(x) ? `${round(x, d)}%` : '—');
/** Romanian count: „1 rulare”, „3 rulări”, „28 de rulări”. */
export const count = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${Number.isInteger(n) && (n % 100 >= 20 || (n !== 0 && n % 100 === 0)) ? 'de ' : ''}${many}`);
const hTxt = (x) => (isNum(x) ? (x >= 48 ? `${round(x / 24, 1)} zile` : `${round(x, 1)} h`) : '—');

function result(gate, status, { value = null, evidence = '', remedy = null, at = null, link = null, signature = null, metric = null } = {}) {
  return { id: gate.id, group: gate.group, title: gate.title, what: gate.what, status, severity: status === STATUS.FAIL ? gate.severity : status === STATUS.WARN ? 'warning' : null, value, evidence, remedy, at, link, signature, metric };
}

/** Steps of a run's jobs whose name matches, with their combined conclusion. */
function stepState(wf, re) {
  const steps = (wf?.jobs ?? []).flatMap((j) => (j.steps ?? []).filter((s) => re.test(s.name)).map((s) => ({ ...s, job: j.name })));
  if (!steps.length) return null;
  if (steps.some((s) => s.conclusion === 'failure')) return { state: 'failure', steps };
  if (steps.every((s) => s.conclusion === 'success')) return { state: 'success', steps };
  if (steps.every((s) => s.conclusion === 'skipped' || s.conclusion === null)) return { state: 'skipped', steps };
  return { state: 'mixed', steps };
}

const runLink = (run) => run?.url ?? null;
const shortSha = (sha) => (sha ? String(sha).slice(0, 7) : '—');
const firstLine = (s) => String(s ?? '').split('\n')[0].slice(0, 90);

/* ───────────────────────────── cod ───────────────────────────── */

function evalCiRun(g, obs) {
  const ci = obs.workflows?.ci;
  const run = ci?.latest;
  if (!run) return result(g, STATUS.UNKNOWN, { evidence: 'Nicio rulare CI încheiată pe ramura principală.' });
  const at = run.updatedAt ?? run.createdAt;
  const about = `${shortSha(run.headSha)} „${firstLine(run.message)}”`;
  if (run.conclusion === 'success') return result(g, STATUS.PASS, { value: 'verde', evidence: `CI pe ${about} a trecut${(ci.jobs ?? []).length > 1 ? ` în ${(ci.jobs ?? []).length} joburi (Node 22 și 24)` : ''}.`, at, link: runLink(run) });
  const failing = (ci.jobs ?? []).flatMap((j) => (j.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => `${j.name}: ${s.name}`));
  const sig = classify((ci.annotations ?? []).map((a) => `${a.title ?? ''} ${a.message ?? ''}`), failing);
  const status = run.conclusion === 'failure' || run.conclusion === 'timed_out' ? STATUS.FAIL : STATUS.WARN;
  return result(g, status, { value: run.conclusion, evidence: `CI pe ${about}: ${run.conclusion}${failing.length ? ` — pașii ${failing.slice(0, 3).join('; ')}` : ''}.`, remedy: sig?.remedy ?? 'deschideți rularea, citiți primul test eșuat și rulați „npm run ci” local.', at, link: runLink(run), signature: sig?.code ?? null });
}

/** A code gate read from the CI gate report (one notice annotation), or from the test step. */
function evalCiGroup(g, obs) {
  const ci = obs.workflows?.ci;
  const run = ci?.latest;
  if (!run) return result(g, STATUS.UNKNOWN, { evidence: 'Nicio rulare CI încheiată.' });
  const at = run.updatedAt ?? run.createdAt;
  const report = ci.gateReport;
  if (report?.groups) {
    const parts = g.ci.map((k) => report.groups[k]).filter(Boolean);
    if (parts.length) {
      const pass = parts.reduce((s, x) => s + (x.pass ?? 0), 0);
      const fail = parts.reduce((s, x) => s + (x.fail ?? 0), 0);
      const names = (report.failures ?? []).filter((f) => g.ci.includes(f.group)).map((f) => f.name);
      if (fail) {
        const sig = classify(names, (report.failures ?? []).filter((f) => g.ci.includes(f.group)).map((f) => f.message));
        return result(g, STATUS.FAIL, { value: `${pass}/${pass + fail}`, evidence: `${count(fail, 'test eșuat', 'teste eșuate')}: ${names.slice(0, 3).join('; ')}.`, remedy: sig?.remedy ?? 'rulați „npm run ci” local; mesajul testului numește regula încălcată.', at, link: runLink(run), signature: sig?.code ?? null });
      }
      return result(g, STATUS.PASS, { value: `${pass}/${pass}`, evidence: `${count(pass, 'verificare trecută', 'verificări trecute')} în CI pe ${shortSha(run.headSha)}.`, at, link: runLink(run) });
    }
    // The report exists but has no test for this group (the agent's own tests before they existed).
    if (g.id === 'ci.agent') return result(g, STATUS.UNKNOWN, { evidence: 'Raportul porților nu conține încă grupul agentului.', at, link: runLink(run) });
  }
  // No gate report (older CI): the combined step tells pass/fail, without the per-group detail.
  const st = stepState(ci, /Syntax \+ tests/i);
  if (!st) return result(g, run.conclusion === 'success' ? STATUS.PASS : STATUS.UNKNOWN, { value: run.conclusion === 'success' ? 'trecut' : null, evidence: run.conclusion === 'success' ? 'CI verde; raportul pe grupe nu este disponibil pentru această rulare.' : 'Fără detaliu pe grupe pentru această rulare.', at, link: runLink(run) });
  if (st.state === 'success') return result(g, STATUS.PASS, { value: 'trecut', evidence: 'Pasul „Syntax + tests” a trecut (raportul pe grupe apare de la următoarea rulare CI).', at, link: runLink(run) });
  if (st.state === 'failure') return result(g, STATUS.UNKNOWN, { evidence: 'Pasul „Syntax + tests” a eșuat, dar fără raport pe grupe nu se poate spune care regulă — vedeți poarta „CI verde”.', at, link: runLink(run) });
  return result(g, STATUS.UNKNOWN, { evidence: 'Pasul de teste nu a rulat.', at, link: runLink(run) });
}

function evalStep(g, obs, role) {
  const wf = obs.workflows?.[role];
  const run = wf?.latest;
  if (!run) return result(g, STATUS.UNKNOWN, { evidence: 'Nicio rulare încheiată.' });
  const at = run.updatedAt ?? run.createdAt;
  const st = stepState(wf, g.step);
  if (!st) return result(g, STATUS.UNKNOWN, { evidence: 'Pasul nu apare în rulare (workflow mai vechi).', at, link: runLink(run) });
  if (st.state === 'success') return result(g, STATUS.PASS, { value: 'trecut', evidence: `Pasul „${st.steps[0].name}” a trecut${st.steps.length > 1 ? ` în ${st.steps.length} joburi` : ''}.`, at, link: runLink(run) });
  if (st.state === 'failure') {
    const sig = classify((wf.annotations ?? []).map((a) => `${a.title ?? ''} ${a.message ?? ''}`), st.steps.map((s) => s.name));
    return result(g, STATUS.FAIL, { value: 'eșuat', evidence: `Pasul „${st.steps[0].name}” a eșuat.`, remedy: sig?.remedy ?? 'deschideți rularea și citiți ieșirea pasului.', at, link: runLink(run), signature: sig?.code ?? null });
  }
  return result(g, STATUS.UNKNOWN, { evidence: 'Pasul nu a rulat (un pas anterior a eșuat).', at, link: runLink(run) });
}

/* ───────────────────────────── rulare ───────────────────────────── */

function evalScanRun(g, obs) {
  const wf = obs.workflows?.scan;
  const run = wf?.latest;
  if (!run) return result(g, STATUS.UNKNOWN, { evidence: 'Nicio scanare încheiată.' });
  const at = run.updatedAt ?? run.createdAt;
  const notes = (wf.annotations ?? []).map((a) => `${a.title ?? ''} ${a.message ?? ''}`);
  if (run.conclusion === 'success') {
    const fellBack = notes.some((n) => /Scanarea a eșuat|Republic ultimul snapshot/i.test(n));
    if (fellBack) {
      const sig = classify(notes);
      return result(g, STATUS.WARN, { value: 'republicat', evidence: 'Scanarea live a eșuat și workflow-ul a republicat ultimul snapshot valid: dashboard-ul arată date mai vechi.', remedy: sig?.remedy ?? 'citiți jurnalul pasului „Full scan (live)”.', at, link: runLink(run), signature: sig?.code ?? null });
    }
    const minutes = (toMs(run.updatedAt) - toMs(run.startedAt ?? run.createdAt)) / 60_000;
    return result(g, STATUS.PASS, { value: 'reușită', evidence: `Scanarea din ${String(run.createdAt).slice(0, 16).replace('T', ' ')} UTC (${run.event}) s-a încheiat în ${isNum(minutes) && minutes >= 0 ? `${round(minutes, 1)} min` : '—'}.`, at, link: runLink(run) });
  }
  const failing = (wf.jobs ?? []).flatMap((j) => (j.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => s.name));
  const sig = classify(notes, failing);
  return result(g, run.conclusion === 'cancelled' ? STATUS.WARN : STATUS.FAIL, { value: run.conclusion, evidence: `Scanarea a ${run.conclusion === 'cancelled' ? 'fost anulată' : 'eșuat'}${failing.length ? ` la pasul „${failing[0]}”` : ''}.`, remedy: sig?.remedy ?? 'deschideți rularea; dacă eșecul e la o sursă, ecranul „Date și surse” o numește.', at, link: runLink(run), signature: sig?.code ?? null });
}

function evalScanSources(g, obs) {
  const s = obs.snapshot;
  if (!s) return result(g, STATUS.UNKNOWN, { evidence: 'Snapshot indisponibil.' });
  const req = (s.coverage ?? []).filter((x) => x.required);
  if (!req.length) return result(g, STATUS.UNKNOWN, { evidence: 'Snapshot-ul nu declară sursele obligatorii.' });
  const bad = req.filter((x) => !x.ok);
  if (bad.length) {
    const sig = classify(bad.map((b) => `${b.status} ${b.message ?? ''}`));
    return result(g, STATUS.FAIL, { value: `${req.length - bad.length}/${req.length}`, evidence: `Surse obligatorii căzute: ${bad.map((b) => `${b.label} (${b.status})`).join(', ')}.`, remedy: sig?.remedy ?? 'fără univers sau lumânări scanarea nu are ce cerceta; verificați furnizorul în ecranul „Date și surse”.', at: s.generatedAt, signature: sig?.code ?? null });
  }
  return result(g, STATUS.PASS, { value: `${req.length}/${req.length}`, evidence: `${req.map((x) => x.label).join(', ')}: OK.`, at: s.generatedAt });
}

function evalProviders(g, obs) {
  const s = obs.snapshot;
  if (!s?.providers?.length) return result(g, STATUS.UNKNOWN, { evidence: 'Snapshot fără starea furnizorilor.' });
  const configured = s.providers.filter((p) => p.status !== 'NOT_CONFIGURED' && p.status !== 'DISABLED');
  const bad = configured.filter((p) => !OK_PROVIDER.has(p.status) || (isNum(p.successRateHistory) && p.successRateHistory < 90 && (p.failures ?? 0) > 0));
  const value = `${configured.length - bad.length}/${configured.length}`;
  if (!bad.length) return result(g, STATUS.PASS, { value, evidence: `Toți cei ${configured.length} furnizori configurați au răspuns.`, at: s.generatedAt });
  const sig = classify(bad.map((b) => `${b.status} ${b.message ?? ''}`));
  return result(g, STATUS.WARN, {
    value,
    evidence: `Cu probleme: ${bad.slice(0, 5).map((b) => `${b.label ?? b.id} (${b.status}${isNum(b.successRateHistory) ? `, ${pctTxt(b.successRateHistory)} istoric` : ''})`).join('; ')}.`,
    remedy: bad.some((b) => b.id === 'solana_rpc') ? 'Solana: nodurile publice limitează getTokenLargestAccounts de pe runnere — un URL RPC dintr-un cont gratuit (Helius Free) în secretul SOLANA_RPC_URL o deblochează. Ceilalți: limite trecătoare, se reiau automat.' : sig?.remedy ?? 'limite trecătoare, se reiau automat; dacă persistă, sonda săptămânală le confirmă.',
    at: s.generatedAt,
    signature: sig?.code ?? null,
  });
}

function evalQuota(g, obs) {
  const q = obs.snapshot?.quota;
  if (!q?.length) return result(g, STATUS.UNKNOWN, { evidence: 'Snapshot fără registrul de cote.' });
  const worst = [...q].sort((a, b) => (b.projectedShare ?? 0) - (a.projectedShare ?? 0))[0];
  const paused = q.filter((x) => x.paused);
  const value = `max ${pctTxt(worst.projectedShare, 1)}`;
  if (paused.length || (worst.projectedShare ?? 0) >= 100) return result(g, STATUS.FAIL, { value, evidence: `${paused.length ? `În pauză: ${paused.map((p) => p.label).join(', ')}. ` : ''}${worst.label}: ${pctTxt(worst.projectedShare, 1)} din planul lunar, proiectat.`, remedy: 'poarta de cote a oprit furnizorul; reduceți cadența sau maxCalls până la resetarea lunii.', at: obs.snapshot.generatedAt });
  if ((worst.projectedShare ?? 0) >= 80) return result(g, STATUS.WARN, { value, evidence: `${worst.label}: ${pctTxt(worst.projectedShare, 1)} din planul lunar, proiectat până la final de lună.`, remedy: 'reduceți maxCalls pentru acest furnizor sau rata de rotație.', at: obs.snapshot.generatedAt });
  return result(g, STATUS.PASS, { value, evidence: `Cel mai solicitat plan: ${worst.label}, ${pctTxt(worst.projectedShare, 1)} din luna proiectată.`, at: obs.snapshot.generatedAt });
}

function evalValidity(g, obs) {
  const s = obs.snapshot;
  const v = s?.validity;
  if (!v) return result(g, STATUS.UNKNOWN, { evidence: 'Snapshot fără poarta de validitate.' });
  const total = (v.valid ?? 0) + (v.pending ?? 0) + (v.rejected ?? 0);
  const covered = isNum(s.eligible) ? total === s.eligible || v.checked === s.eligible : true;
  const leaked = s.rejectedInLists ?? 0;
  const value = `${v.valid}/${v.pending}/${v.rejected}`;
  if (leaked > 0) return result(g, STATUS.FAIL, { value, evidence: `${leaked} proiecte respinse apar în listele CRI.`, remedy: 'regulă încălcată: doar proiectele verificate intră în liste — rulați testele de validitate.', at: s.generatedAt });
  if (!covered) return result(g, STATUS.WARN, { value, evidence: `Verdicte pentru ${total} din ${s.eligible} proiecte eligibile.`, remedy: 'unele proiecte eligibile nu au verdict; verificați pasul de validitate din scanare.', at: s.generatedAt });
  return result(g, STATUS.PASS, { value, evidence: `${v.valid} verificate, ${v.pending} în verificare, ${v.rejected} respinse; niciun proiect respins în liste.`, at: s.generatedAt });
}

function evalForecast(g, obs) {
  const f = obs.snapshot?.forecast;
  if (!obs.snapshot) return result(g, STATUS.UNKNOWN, { evidence: 'Snapshot indisponibil.' });
  if (!f) return result(g, STATUS.UNKNOWN, { evidence: 'Snapshot-ul nu are încă prognoza (motorul publicat este anterior modulului).', at: obs.snapshot.generatedAt });
  const winners = f.winners ?? [];
  const confirmed = winners.filter((w) => w.status === 'CONFIRMED');
  const r100 = (f.baseRates ?? []).find((r) => r.multiple === 100);
  const lookAhead = confirmed.filter((w) => w.anchorAt && w.low?.at && w.anchorAt > w.low.at);
  const value = `${confirmed.length} confirmați`;
  if (lookAhead.length) return result(g, STATUS.FAIL, { value, evidence: `Amprentă măsurată după minim la ${lookAhead.map((w) => w.symbol).join(', ')} — date din viitor.`, remedy: 'regula point-in-time este încălcată; testele de domeniu ale prognozei trebuie să o prindă.', at: obs.snapshot.generatedAt });
  if (r100 && !(r100.pct > 0 && r100.pct <= 5)) return result(g, STATUS.WARN, { value, evidence: `Rata de bază ≥100× = ${r100.pct}% — în afara intervalului plauzibil (0–5% pe an).`, remedy: 'verificați populația urmărită și lista de învățare.', at: obs.snapshot.generatedAt });
  if (confirmed.length < 3) return result(g, STATUS.WARN, { value, evidence: `Doar ${confirmed.length} câștigători confirmați din istoric; restul așteaptă bugetul de istoric (câteva pe rulare).`, remedy: 'normal în primele rulări: lista se confirmă treptat, în bugetul gratuit CoinGecko.', at: obs.snapshot.generatedAt });
  return result(g, STATUS.PASS, { value, evidence: `${confirmed.length} câștigători confirmați din istoricul zilnic; rata de bază ≥100×: ${r100 ? `${r100.pct}% (${r100.lo}–${r100.hi}%)` : '—'}.`, at: obs.snapshot.generatedAt });
}

function evalDuration(g, obs, ctx) {
  const s = obs.snapshot;
  if (!isNum(s?.durationMs)) return result(g, STATUS.UNKNOWN, { evidence: 'Durata scanării nu este publicată.' });
  const min = s.durationMs / 60_000;
  const limit = ctx.limits?.scanMaxMinutes;
  const a = assess(ctx.series?.['scan.durationMin'], min, toMs(s.generatedAt), { ...ctx.norms, direction: 'high' });
  const value = `${round(min, 1)} min`;
  if (isNum(limit) && min > 0.95 * limit) return result(g, STATUS.WARN, { value, evidence: `${round(min, 1)} min din limita de ${limit} min.`, remedy: 'aproape de limită: o sursă lentă poate opri cercetarea înainte de final; reduceți deep.limit sau verificați furnizorul lent.', at: s.generatedAt, metric: a });
  if (a.status === 'ANOMALY') return result(g, STATUS.WARN, { value, evidence: `${round(min, 1)} min față de norma învățată de ${a.median} min (z = ${a.z}).`, remedy: 'o sursă a devenit lentă; ecranul „Date și surse” arată latența pe furnizor.', at: s.generatedAt, metric: a });
  return result(g, STATUS.PASS, { value, evidence: `${round(min, 1)} min${isNum(limit) ? ` din ${limit}` : ''}${a.status === 'NORMAL' ? `; norma învățată ${a.median} min` : `; norma se învață (${a.n} rulări)`}.`, at: s.generatedAt, metric: a });
}

function evalUniverse(g, obs, ctx) {
  const s = obs.snapshot;
  const u = s?.universe;
  if (!u) return result(g, STATUS.UNKNOWN, { evidence: 'Snapshot fără univers.' });
  const topN = ctx.limits?.topN ?? 1000;
  const a = assess(ctx.series?.['scan.eligible'], u.eligible, toMs(s.generatedAt), { ...ctx.norms, direction: 'low', relFloor: 0.05 });
  const value = `${u.eligible ?? '—'} eligibile`;
  if (isNum(u.coingecko) && u.coingecko < 0.98 * topN) return result(g, STATUS.WARN, { value, evidence: `CoinGecko a livrat ${u.coingecko} din ${topN} proiecte.`, remedy: 'o pagină a listei lipsește (limită de rată); rularea următoare o reia.', at: s.generatedAt, metric: a });
  if (a.status === 'ANOMALY') return result(g, STATUS.WARN, { value, evidence: `${u.eligible} proiecte eligibile față de norma de ${a.median} (z = ${a.z}).`, remedy: 'o sursă de univers (Binance Alpha, Gate Alpha, CoinGecko) a livrat mai puțin; verificați ecranul „Date și surse”.', at: s.generatedAt, metric: a });
  return result(g, STATUS.PASS, { value, evidence: `${u.merged ?? '—'} unificate, ${u.eligible} eligibile, ${u.deep ?? '—'} cercetate în profunzime${a.status === 'NORMAL' ? '; în normă' : ''}.`, at: s.generatedAt, metric: a });
}

function evalState(g, obs) {
  const s = obs.snapshot;
  const meta = obs.stateMeta;
  if (!s || !meta) return result(g, STATUS.UNKNOWN, { evidence: 'Ramura de stare nu este disponibilă agentului.' });
  const okRun = obs.workflows?.scan?.lastSuccess;
  const snapAt = toMs(s.generatedAt);
  if (meta.lastRunAt && toMs(meta.lastRunAt) !== snapAt) return result(g, STATUS.WARN, { value: 'nesincron', evidence: `Starea are ultima rulare ${meta.lastRunAt}, snapshot-ul ${s.generatedAt}.`, remedy: 'pasul „Save research state” trebuie să copieze snapshot-ul odată cu starea.', at: s.generatedAt });
  if (okRun && snapAt < toMs(okRun.createdAt) - 10 * 60_000) return result(g, STATUS.WARN, { value: 'în urmă', evidence: `Ultima scanare reușită a pornit la ${okRun.createdAt}, dar starea are snapshot-ul din ${s.generatedAt}.`, remedy: 'verificați pasul de push pe cri-state (permisiuni „Read and write”).', at: s.generatedAt });
  return result(g, STATUS.PASS, { value: isNum(meta.runs) ? count(meta.runs, 'rulare', 'rulări') : '—', evidence: `cri-state conține snapshot-ul ultimei scanări (${s.generatedAt}); ${isNum(meta.runs) ? count(meta.runs, 'rulare', 'rulări') : '—'} de la ${String(meta.firstRunAt ?? '').slice(0, 10)}.`, at: s.generatedAt });
}

function evalPages(g, obs) {
  const p = obs.pages;
  const s = obs.snapshot;
  if (!p) return result(g, STATUS.UNKNOWN, { evidence: 'Site-ul nu a fost verificat în această rulare.' });
  if (p.via === 'deployments') {
    const about = `ultimul deploy GitHub Pages (${String(p.deployedAt ?? '').slice(0, 16).replace('T', ' ')} UTC, commit ${shortSha(p.sha)})`;
    if (p.ok) return result(g, STATUS.PASS, { value: 'deploy reușit', evidence: `${about[0].toUpperCase()}${about.slice(1)} a reușit; conținutul site-ului nu a putut fi citit direct din această rulare.`, at: p.deployedAt, link: p.url });
    if (['failure', 'error'].includes(p.state)) return result(g, STATUS.FAIL, { value: `deploy ${p.state}`, evidence: `${about[0].toUpperCase()}${about.slice(1)} a eșuat.`, remedy: 'Settings → Pages → Source: „GitHub Actions”; apoi rulați „Scan & deploy”.', at: p.deployedAt, link: p.url, signature: 'PAGES_SETTINGS' });
    return result(g, STATUS.UNKNOWN, { value: `deploy ${p.state ?? '—'}`, evidence: `${about[0].toUpperCase()}${about.slice(1)} este în starea „${p.state ?? '—'}”.`, at: p.deployedAt, link: p.url });
  }
  // A network error on the agent's side says nothing about the site; an HTTP answer does.
  if (!p.ok && p.reason !== 'HTTP_ERROR') return result(g, STATUS.UNKNOWN, { evidence: `Site-ul nu a putut fi verificat din runner (${p.status ?? 'eroare de rețea'}).`, at: obs.nowIso, link: p.url });
  if (!p.ok) return result(g, STATUS.FAIL, { value: p.status ?? 'indisponibil', evidence: `${p.url} răspunde cu eroare (${p.status ?? 'eroare'}).`, remedy: 'Settings → Pages → Source: „GitHub Actions”; apoi rulați „Scan & deploy”.', at: obs.nowIso, link: p.url, signature: 'PAGES_SETTINGS' });
  if (s && p.generatedAt !== s.generatedAt) {
    const lagH = (toMs(s.generatedAt) - toMs(p.generatedAt)) / HOUR_MS;
    if (lagH > 0) return result(g, STATUS.WARN, { value: `în urmă ${hTxt(lagH)}`, evidence: `Site-ul servește rularea din ${p.generatedAt}, starea are ${s.generatedAt}.`, remedy: 'jobul „deploy” al ultimei scanări nu s-a încheiat; următorul puls sau scanare republică.', at: obs.nowIso, link: p.url });
  }
  return result(g, STATUS.PASS, { value: 'sincron', evidence: `${p.url} servește rularea din ${p.generatedAt}.`, at: obs.nowIso, link: p.url });
}

function evalFreshness(g, obs, ctx) {
  const s = obs.snapshot;
  if (!s?.generatedAt) return result(g, STATUS.UNKNOWN, { evidence: 'Snapshot indisponibil.' });
  const ageH = (obs.nowMs - toMs(s.generatedAt)) / HOUR_MS;
  const interval = ctx.expectedIntervalHours?.scan ?? 4;
  const f = ctx.freshness ?? { warnFactor: 1.5, failFactor: 3 };
  const value = hTxt(ageH);
  if (ageH > f.failFactor * interval) return result(g, STATUS.FAIL, { value, evidence: `Ultima scanare are ${hTxt(ageH)}; cadența promisă este ${round(interval, 1)} h.`, remedy: 'agentul pornește o scanare când nu rulează nimic (auto-reparare); dacă tot nu pornește, verificați că workflow-ul este activ.', at: s.generatedAt });
  if (ageH > f.warnFactor * interval) return result(g, STATUS.WARN, { value, evidence: `Ultima scanare are ${hTxt(ageH)} (cadență promisă ${round(interval, 1)} h).`, remedy: 'GitHub a sărit programări; agentul completează cadența cu workflow_dispatch, în limita configurată.', at: s.generatedAt });
  return result(g, STATUS.PASS, { value, evidence: `Snapshot vechi de ${hTxt(ageH)}${s.pulsedAt ? `; ultimul puls ${s.pulsedAt.slice(11, 16)} UTC` : ''}.`, at: s.generatedAt });
}

function evalSecrets(g, obs) {
  const sc = obs.secrets;
  if (!sc) return result(g, STATUS.UNKNOWN, { evidence: 'Fișierele publicate nu au fost scanate.' });
  if (sc.leaks?.length) return result(g, STATUS.FAIL, { value: `${sc.leaks.length} potriviri`, evidence: `Tipare de cheie în: ${[...new Set(sc.leaks.map((l) => l.file))].join(', ')} (${[...new Set(sc.leaks.map((l) => l.pattern))].join(', ')}).`, remedy: 'rotiți cheia la furnizor imediat, apoi găsiți mesajul care o include: un URL cu cheie nu trebuie să ajungă în telemetrie sau în snapshot (redactorul clientului HTTP).', at: obs.nowIso });
  return result(g, STATUS.PASS, { value: count(sc.files, 'fișier', 'fișiere'), evidence: `${count(sc.files, 'fișier publicat scanat', 'fișiere publicate scanate')} (${sc.bytesKb ?? '—'} KB): nicio cheie, niciun URL cu cheie.`, at: obs.nowIso });
}

/* ───────────────────────────── cadenta ───────────────────────────── */

function evalCadence(g, obs, ctx) {
  const wf = obs.workflows?.[g.role];
  if (!wf) return result(g, STATUS.UNKNOWN, { evidence: 'Workflow-ul nu a fost găsit.' });
  if (!wf.cron || (Array.isArray(wf.cron) && !wf.cron.length)) return result(g, STATUS.UNKNOWN, { evidence: 'Workflow fără programare cron.' });
  if (wf.runsOk === false) return result(g, STATUS.UNKNOWN, { evidence: 'Lista rulărilor nu a răspuns în această trecere (API GitHub).' });
  const c = observedCadence(wf.runs, { nowMs: obs.nowMs, windowDays: ctx.cadenceWindowDays ?? 7, cron: wf.cron });
  const th = wf.cadence ?? {};
  const value = `${c.perDay}/${round(c.expectedPerDay, 1)} pe zi`;
  const evidence = `${count(c.runs, 'rulare', 'rulări')} în ${c.spanDays} zile = ${c.perDay}/zi față de ${round(c.expectedPerDay, 1)}/zi promise de „${[].concat(wf.cron).join(' + ')}” (${pctTxt((c.ratio ?? 0) * 100)}); interval median ${hTxt(c.medianGapHours)}, maxim ${hTxt(c.maxGapHours)}.`;
  const remedy = 'GitHub rulează programările „best effort” și le sare la ore aglomerate; agentul completează cadența cu workflow_dispatch când nu rulează nimic, în limita zilnică din agent/config.json.';
  if (!c.runs) return result(g, STATUS.FAIL, { value, evidence: `Nicio rulare în ultimele ${c.windowDays} zile.`, remedy: 'verificați că workflow-ul este activ (Actions → workflow → Enable).', at: obs.nowIso });
  if (isNum(th.failBelow) && c.ratio < th.failBelow) return result(g, STATUS.FAIL, { value, evidence, remedy, at: obs.nowIso, metric: c });
  if (isNum(th.warnBelow) && c.ratio < th.warnBelow) return result(g, STATUS.WARN, { value, evidence, remedy, at: obs.nowIso, metric: c });
  return result(g, STATUS.PASS, { value, evidence, at: obs.nowIso, metric: c });
}

function evalActive(g, obs) {
  const list = Object.values(obs.workflows ?? {}).filter((w) => w?.state);
  if (!list.length) return result(g, STATUS.UNKNOWN, { evidence: 'Lista workflow-urilor nu este disponibilă.' });
  const off = list.filter((w) => w.state !== 'active');
  if (off.some((w) => w.state === 'disabled_inactivity')) return result(g, STATUS.FAIL, { value: `${list.length - off.length}/${list.length}`, evidence: `Dezactivate pentru inactivitate: ${off.map((w) => w.name).join(', ')}.`, remedy: 'Actions → workflow → „Enable workflow”; orice commit pe main resetează contorul de 60 de zile.', at: obs.nowIso });
  if (off.length) return result(g, STATUS.WARN, { value: `${list.length - off.length}/${list.length}`, evidence: `Dezactivate: ${off.map((w) => `${w.name} (${w.state})`).join(', ')}.`, remedy: 'Actions → workflow → „Enable workflow”.', at: obs.nowIso });
  return result(g, STATUS.PASS, { value: `${list.length}/${list.length}`, evidence: `Active: ${list.map((w) => w.name).join(', ')}.`, at: obs.nowIso });
}

function evalInactivity(g, obs, ctx) {
  const at = toMs(obs.repo?.lastCommitAt);
  if (!isNum(at)) return result(g, STATUS.UNKNOWN, { evidence: 'Data ultimului commit nu este disponibilă.' });
  const days = (obs.nowMs - at) / DAY_MS;
  const t = ctx.inactivity ?? { warnDays: 50, failDays: 60 };
  const value = `${round(days, 1)} zile`;
  const evidence = `Ultimul commit pe ${obs.repo.defaultBranch ?? 'main'}: ${obs.repo.lastCommitAt.slice(0, 10)} (acum ${round(days, 1)} zile).`;
  if (days >= t.failDays) return result(g, STATUS.FAIL, { value, evidence, remedy: 'faceți orice commit pe main și reactivați workflow-urile programate.', at: obs.nowIso });
  if (days >= t.warnDays) return result(g, STATUS.WARN, { value, evidence, remedy: `GitHub oprește programările după 60 de zile fără activitate; un commit pe main în următoarele ${Math.max(0, Math.ceil(t.failDays - days))} zile resetează contorul.`, at: obs.nowIso });
  return result(g, STATUS.PASS, { value, evidence, at: obs.nowIso });
}

/* ───────────────────────────── periodic ───────────────────────────── */

function evalPeriodic(g, obs) {
  const wf = obs.workflows?.[g.role];
  if (!wf) return result(g, STATUS.UNKNOWN, { evidence: 'Workflow-ul nu a fost găsit.' });
  if (wf.runsOk === false) return result(g, STATUS.UNKNOWN, { evidence: 'Lista rulărilor nu a răspuns în această trecere (API GitHub).' });
  const run = wf.latest;
  const maxAge = wf.maxAgeDays ?? 8;
  if (!run) {
    const created = toMs(wf.createdAt);
    const young = isNum(created) && obs.nowMs - created < maxAge * DAY_MS;
    return result(g, young ? STATUS.UNKNOWN : STATUS.WARN, { evidence: young ? 'Workflow nou: așteaptă prima rulare programată.' : `Nicio rulare încheiată în ${maxAge} zile.`, remedy: young ? null : 'rulați-l manual din Actions (workflow_dispatch).', at: obs.nowIso });
  }
  const ageD = (obs.nowMs - toMs(run.createdAt)) / DAY_MS;
  const at = run.updatedAt ?? run.createdAt;
  if (run.conclusion === 'failure') {
    const sig = classify((wf.annotations ?? []).map((a) => `${a.title ?? ''} ${a.message ?? ''}`));
    const broken = (wf.annotations ?? []).filter((a) => a.level === 'failure').map((a) => a.title).filter(Boolean);
    return result(g, STATUS.FAIL, { value: 'eșuat', evidence: `Rularea din ${run.createdAt.slice(0, 10)} a eșuat${broken.length ? `: ${broken.slice(0, 4).join(', ')}` : ''}.`, remedy: sig?.remedy ?? 'o sursă gratuită este stricată sau blochează IP-urile GitHub; ecranul „Date și surse” arată care.', at, link: runLink(run), signature: sig?.code ?? null });
  }
  if (ageD > maxAge) return result(g, STATUS.WARN, { value: `${round(ageD, 1)} zile`, evidence: `Ultima rulare acum ${round(ageD, 1)} zile (așteptat: cel mult ${maxAge}).`, remedy: 'rulați-l manual din Actions; GitHub poate sări programări.', at, link: runLink(run) });
  return result(g, STATUS.PASS, { value: run.conclusion, evidence: `Ultima rulare ${run.createdAt.slice(0, 10)} (${run.event}): ${run.conclusion}.`, at, link: runLink(run) });
}

/* ───────────────────────────── model ───────────────────────────── */

function evalCalibration(g, obs, ctx) {
  const c = ctx.calibration;
  if (!c || !c.predictions) return result(g, STATUS.LEARNING, { evidence: 'Registrul prognozelor începe cu prima cohortă săptămânală; calibrarea se poate judeca după ce trec luni.' });
  const i20 = c.interim?.['20'];
  const value = count(c.predictions, 'prognoză', 'prognoze');
  if (c.matured && isNum(c.skill?.['20'])) {
    const sk = c.skill['20'];
    return result(g, sk >= 0 ? STATUS.PASS : STATUS.WARN, { value, evidence: `La scadență: Brier ≥20× ${c.brier?.['20']}, față de rata de bază ${c.brierBase?.['20']} (skill ${sk}).`, remedy: sk >= 0 ? null : 'prognoza nu bate rata de bază: ajustarea pe amprentă adaugă zgomot; pragul de shrinkage (shrinkK) trebuie mărit.', at: obs.nowIso });
  }
  if (!i20 || !(i20.expected >= 3)) return result(g, STATUS.LEARNING, { value, evidence: `${count(c.cohorts, 'cohortă', 'cohorte')}, ${count(c.predictions, 'prognoză', 'prognoze')}; așteptate până acum ${i20 ? round(i20.expected, 2) : 0} creșteri ≥20×, observate ${i20?.observed ?? 0} — prea puține pentru un verdict.`, at: obs.nowIso });
  const inside = i20.lower <= 1 && i20.upper >= 1;
  return result(g, inside ? STATUS.PASS : STATUS.WARN, { value, evidence: `≥20×: observate ${i20.observed}, așteptate ${round(i20.expected, 1)} (raport ${round(i20.ratio, 2)}, interval 90% ${round(i20.lower, 2)}–${round(i20.upper, 2)}).`, remedy: inside ? null : i20.ratio > 1 ? 'prognoza subestimează: rata de bază prudentă (priorRate) poate fi prea mică.' : 'prognoza supraestimează: lista de învățare are bias de supraviețuire; creșteți priorWeight.', at: obs.nowIso });
}

function evalTrackRecord(g, obs) {
  const tr = obs.snapshot?.trackRecord;
  if (!tr) return result(g, STATUS.UNKNOWN, { evidence: 'Snapshot fără track record.' });
  const hz = Object.values(tr.horizons ?? {});
  const ready = hz.filter((h) => h.sufficient);
  const open = tr.open ?? tr.total ?? 0;
  if (!ready.length) return result(g, STATUS.LEARNING, { value: count(tr.total ?? 0, 'semnal', 'semnale'), evidence: `${count(tr.total ?? 0, 'semnal', 'semnale')} în cohorta „${tr.cohort ?? '—'}”, ${open} deschise; nicio scadență nu are încă destule intrări pentru un verdict.`, at: obs.snapshot.generatedAt });
  const h = ready.sort((a, b) => b.horizonDays - a.horizonDays)[0];
  const good = isNum(h.medianAlphaPct) ? h.medianAlphaPct >= 0 : (h.winRate ?? 0) >= 0.5;
  return result(g, good ? STATUS.PASS : STATUS.WARN, { value: `${h.horizonDays} zile`, evidence: `La ${h.horizonDays} zile: ${h.n} semnale, rata de câștig ${pctTxt((h.winRate ?? 0) * 100)}, alfa median ${pctTxt(h.medianAlphaPct, 1)}.`, remedy: good ? null : 'semnalele nu bat piața la această scadență; pragurile de semnal trebuie revăzute.', at: obs.snapshot.generatedAt });
}

/* ───────────────────────────── agent ───────────────────────────── */

function evalMemory(g, obs, ctx) {
  const m = ctx.memoryInfo;
  if (!m) return result(g, STATUS.UNKNOWN, { evidence: 'Memoria nu a fost încărcată.' });
  const learned = m.metrics.filter((x) => x.n >= (ctx.norms?.minSamples ?? 8)).length;
  const value = count(m.runs, 'rulare', 'rulări');
  const evidence = `${count(m.runs, 'rulare a agentului', 'rulări ale agentului')} din ${String(m.since ?? '').slice(0, 10)}; ${learned}/${m.metrics.length} norme învățate; ${count(m.incidents.open, 'incident deschis', 'incidente deschise')}, ${m.incidents.resolved} rezolvate; ${count(m.fixes, 'remediere reținută', 'remedieri reținute')}.`;
  if (m.fresh) return result(g, STATUS.LEARNING, { value, evidence: `Prima rulare: memoria pornește de la zero (istoricul de rulări GitHub este importat).`, at: obs.nowIso });
  return result(g, learned ? STATUS.PASS : STATUS.LEARNING, { value, evidence, at: obs.nowIso });
}

function evalNarrator(g, obs, ctx) {
  const n = ctx.narrative;
  if (!n) return result(g, STATUS.UNKNOWN, { evidence: 'Nicio narațiune încă.' });
  if (n.by === 'template' && n.reason === 'disabled') return result(g, STATUS.PASS, { value: 'șablon', evidence: 'Modelul local este dezactivat; rezumatul vine din șablonul determinist.', at: n.at });
  if (n.by === 'template' && n.reason) return result(g, STATUS.WARN, { value: 'șablon', evidence: `Modelul local nu a putut fi folosit (${n.reason}); rezumatul vine din șablonul determinist.`, remedy: 'pasul Ollama din workflow-ul agentului este opțional; verificați jurnalul lui sau variabila CRI_AGENT_MODEL.', at: n.at });
  return result(g, STATUS.PASS, { value: n.model ?? 'model local', evidence: `Rezumat scris de ${n.model ?? 'modelul local'}${n.guard ? `, verificat: ${n.guard}` : ''}.`, at: n.at });
}

const EVAL = {
  'ci.run': evalCiRun,
  'scan.run': evalScanRun,
  'scan.contract': (g, obs) => evalStep(g, obs, 'scan'),
  'scan.sources': evalScanSources,
  'scan.providers': evalProviders,
  'scan.quota': evalQuota,
  'scan.validity': evalValidity,
  'scan.forecast': evalForecast,
  'scan.duration': evalDuration,
  'scan.universe': evalUniverse,
  'scan.state': evalState,
  'scan.pages': evalPages,
  'scan.freshness': evalFreshness,
  'scan.secrets': evalSecrets,
  'cad.scan': evalCadence,
  'cad.pulse': evalCadence,
  'cad.active': evalActive,
  'cad.inactivity': evalInactivity,
  'per.probe': evalPeriodic,
  'per.labels': evalPeriodic,
  'model.calibration': evalCalibration,
  'model.trackrecord': evalTrackRecord,
  'agent.memory': evalMemory,
  'agent.narrator': evalNarrator,
};

/**
 * Evaluate the whole catalogue.
 * @param {any} obs  observations (see application/observe.js)
 * @param {{series?:Record<string,[number,number][]>, norms?:any, limits?:any, cadenceWindowDays?:number,
 *          expectedIntervalHours?:Record<string,number>, freshness?:any, inactivity?:any,
 *          calibration?:any, memoryInfo?:any, narrative?:any}} ctx
 */
export function evaluateGates(obs, ctx = {}) {
  return GATES.map((g) => {
    try {
      if (EVAL[g.id]) return EVAL[g.id](g, obs, ctx);
      if (g.ci) return evalCiGroup(g, obs);
      if (g.step) return evalStep(g, obs, 'ci');
      return result(g, STATUS.UNKNOWN, { evidence: 'Fără evaluator.' });
    } catch (err) {
      return result(g, STATUS.UNKNOWN, { evidence: `Evaluare eșuată: ${String(err?.message ?? err).slice(0, 120)}` });
    }
  });
}

/** Counts per status and the overall verdict: any FAIL → FAIL, any WARN → WARN, else PASS. */
export function summarize(results) {
  const counts = Object.fromEntries(Object.values(STATUS).map((s) => [s, results.filter((r) => r.status === s).length]));
  const overall = counts.FAIL ? STATUS.FAIL : counts.WARN ? STATUS.WARN : STATUS.PASS;
  return { overall, counts, total: results.length };
}
