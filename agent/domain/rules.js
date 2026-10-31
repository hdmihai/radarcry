/**
 * FUNDAMENTAL RULES — the agent's written knowledge of how the radar must be judged.
 *
 * The rulebook (agent/knowledge/rules.json) states, in the owner's words, what "the radar identifies
 * the right projects" and "the forecast tells the truth" mean, each rule with a machine-readable check.
 * The agent loads it into its memory on every run (version and fingerprint, so a change of the rules
 * is itself an event it records), evaluates every rule on the project's own data and keeps the
 * verdict history of each one.
 *
 * Verdicts follow the gates' vocabulary: PASS · WARN · FAIL · LEARNING (the sample is still too small,
 * P-3) · UNKNOWN (nothing to judge from, P-2 — never read as bad). A rule never changes a business
 * threshold (P-5); when the data argue for a different one, the rule carries a recommendation with
 * the evidence, and the owner decides.
 *
 * Pure: the rulebook, the measurements and the gate results arrive as arguments.
 */
import { bestTier, TIERS } from './identification.js';
import { fnv1a, isNum, round } from './stats.js';

export const RULE_STATUS = Object.freeze({ PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN', LEARNING: 'LEARNING' });
const S = RULE_STATUS;
export const RULE_CODE = Object.freeze({ PASS: 'P', WARN: 'W', FAIL: 'F', UNKNOWN: 'U', LEARNING: 'L' });
export const AREAS = Object.freeze([
  { id: 'principiu', label: 'Principii' },
  { id: 'identificare', label: 'Eficiența identificării' },
  { id: 'prognoză', label: 'Prognoza ≥100× / ≥20×' },
  { id: 'monitorizare', label: 'Monitorizare și învățare' },
]);

/** Gates whose verdict is itself derived from the rules: a rule may not depend on them. */
export const RULE_GATES = Object.freeze(['model.identification', 'agent.rules', 'agent.learning']);

const RO = { PASS: 'trecută', WARN: 'atenționare', FAIL: 'eșuată', UNKNOWN: 'necunoscută', LEARNING: 'în învățare' };
const WORST = [S.FAIL, S.WARN, S.UNKNOWN, S.LEARNING, S.PASS];
const worst = (list) => WORST.find((s) => list.includes(s)) ?? S.UNKNOWN;
const tierLabel = (id) => TIERS.find((t) => t.id === id)?.label ?? id;
const pctTxt = (x, d = 1) => (isNum(x) ? `${round(x, d)}%` : '—');
const lift = (x) => (isNum(x) ? `${round(x, 2)}` : '—');
const windowLabel = (book, w) => book?.windows?.[w]?.label ?? w;

/** The canonical fingerprint of a rulebook: any edit of a rule or a threshold changes it. */
export function rulebookHash(book) {
  return fnv1a(JSON.stringify({ version: book?.version ?? null, windows: book?.windows ?? null, rules: (book?.rules ?? []).map((r) => ({ id: r.id, rule: r.rule, check: r.check })) }));
}

/** Structural problems of a rulebook (duplicate ids, unknown checks, missing fields). */
export function validateRulebook(book) {
  const problems = [];
  if (!book || !Array.isArray(book.rules)) return ['regulile lipsesc'];
  const seen = new Set();
  for (const r of book.rules) {
    if (!r?.id || !r.title || !r.rule) problems.push(`regulă incompletă: ${r?.id ?? '?'}`);
    if (seen.has(r?.id)) problems.push(`id duplicat: ${r.id}`);
    seen.add(r?.id);
    if (!CHECKS[r?.check?.type]) problems.push(`${r?.id}: verificare necunoscută „${r?.check?.type}”`);
    if (!AREAS.some((a) => a.id === r?.area)) problems.push(`${r?.id}: zonă necunoscută „${r?.area}”`);
  }
  return problems;
}

/* ───────────────────────────── checks ───────────────────────────── */

const out = (status, value, evidence, recommendation = null) => ({ status, value: value ?? null, evidence, recommendation });
const tierOf = (eff, id) => eff?.tiers?.find((t) => t.id === id) ?? null;
const needData = (eff, book, w) => out(S.LEARNING, null, `Fereastra ${windowLabel(book, w)} nu are încă observații cu orizontul încheiat (${eff?.observations ?? 0} observații, ${eff?.scans ?? 0} scanări).`);

function tierText(t, eff, book, w) {
  return `${t.label}: ${pctTxt(t.ratePct)} [${pctTxt(t.loPct)}–${pctTxt(t.hiPct)}] din ${t.n} observații (${t.assets} proiecte) au atins ${windowLabel(book, w)}, față de ${pctTxt(eff.baseRatePct)} în univers → lift ${lift(t.lift)}`;
}

const CHECKS = {
  principle(c, f) {
    const gates = (c.gates ?? []).filter((id) => !RULE_GATES.includes(id));
    const found = gates.map((id) => f.gates?.find((g) => g.id === id)).filter(Boolean);
    if (!found.length) return out(S.UNKNOWN, null, `Aplicare: ${c.enforcedBy ?? 'cod'}. Porțile care o verifică nu au fost observate în această rulare.`);
    const st = worst(found.map((g) => g.status));
    const status = st === S.PASS ? S.PASS : st === S.FAIL ? S.FAIL : st === S.WARN ? S.WARN : S.UNKNOWN;
    return out(status, found.map((g) => `${g.id} ${g.status === S.PASS ? '✓' : g.status}`).join(' · '), `Aplicare: ${c.enforcedBy ?? 'cod'}. Verificată de: ${found.map((g) => `${g.id} — ${RO[g.status] ?? g.status}`).join(', ')}.`);
  },

  tierLift(c, f, book) {
    const eff = f.identification?.[c.window];
    if (!eff?.observations) return needData(eff, book, c.window);
    const t = tierOf(eff, c.tier);
    if (!t) return out(S.UNKNOWN, null, `Nivelul ${c.tier} nu este măsurat.`);
    if (!t.ready) return out(S.LEARNING, t.n ? `×${lift(t.lift)}` : null, `${tierLabel(c.tier)}: ${t.n} observații din ${t.assets} proiecte — sub pragul de ${eff.minObs ?? 30} observații din cel puțin 10 proiecte (P-3).`);
    const txt = `${tierText(t, eff, book, c.window)} (prag ${c.min}).`;
    if (t.lift >= c.min) return out(S.PASS, `×${lift(t.lift)}`, txt);
    if (isNum(t.liftHi) && t.liftHi <= 1) return out(S.FAIL, `×${lift(t.lift)}`, `${txt} Nici limita superioară a intervalului (${lift(t.liftHi)}) nu bate piața.`, 'nivelul nu ierarhizează: factorii care îl compun trebuie revăzuți (ecranul „Metodologie”).');
    return out(S.WARN, `×${lift(t.lift)}`, `${txt} Sub prag, dar intervalul (${lift(t.liftLo)}–${lift(t.liftHi)}) îl include încă.`);
  },

  monotone(c, f, book) {
    const eff = f.identification?.[c.window];
    if (!eff?.observations) return needData(eff, book, c.window);
    const tol = c.tolerancePct ?? 2;
    const breaks = [];
    const strong = [];
    let compared = 0;
    for (const order of c.orders ?? []) {
      const ts = order.map((id) => tierOf(eff, id)).filter((t) => t?.ready);
      for (let i = 1; i < ts.length; i += 1) {
        compared += 1;
        const a = ts[i - 1];
        const b = ts[i];
        if (a.ratePct > b.ratePct + tol) {
          breaks.push(`${a.id} ${pctTxt(a.ratePct)} > ${b.id} ${pctTxt(b.ratePct)}`);
          if (isNum(a.loPct) && isNum(b.hiPct) && a.loPct > b.hiPct) strong.push(`${a.id} > ${b.id}`);
        }
      }
    }
    const chain = (c.orders ?? []).map((o) => o.map((id) => `${id} ${pctTxt(tierOf(eff, id)?.ratePct)}`).join(' ≤ ')).join('; ');
    if (!compared) return out(S.LEARNING, null, `Prea puține niveluri cu eșantion suficient pentru a compara ordinea (${chain}).`);
    if (strong.length) return out(S.FAIL, `${breaks.length} inversiuni`, `Ordinea este inversată semnificativ: ${strong.join(', ')} (intervalele nu se suprapun). Lanț: ${chain}.`, 'scorul trimite atenția spre nivelul greșit; pragurile benzilor sau ponderile factorilor trebuie revăzute.');
    if (breaks.length) return out(S.WARN, `${breaks.length} inversiuni`, `Ordinea nu este respectată: ${breaks.join(', ')} (toleranță ${tol} p.p.; intervalele se suprapun). Lanț: ${chain}.`);
    return out(S.PASS, 'ordonat', `Ratele cresc odată cu nivelul: ${chain}.`);
  },

  lateIsLate(c, f, book) {
    const eff = f.identification?.[c.window];
    if (!eff?.observations) return needData(eff, book, c.window);
    const t = tierOf(eff, c.tier);
    if (!t?.ready) return out(S.LEARNING, t?.n ? `${pctTxt(t.medianEndPct)}` : null, `${tierLabel(c.tier)}: ${t?.n ?? 0} observații din ${t?.assets ?? 0} proiecte — eșantion prea mic (P-3)${t?.n ? `; până acum rezultat median ${pctTxt(t.medianEndPct)}, ${t.hits} creșteri de ${windowLabel(book, c.window)}` : ''}.`);
    const txt = `${tierText(t, eff, book, c.window)}; rezultat median la final ${pctTxt(t.medianEndPct)}.`;
    if (isNum(t.liftLo) && t.liftLo > c.maxLift) return out(S.FAIL, `×${lift(t.lift)}`, `${txt} Eticheta „târziu” ascunde proiecte care continuă să crească.`, 'stadiul 3 trebuie redefinit sau separat într-o variantă „momentum”.');
    if (t.lift > c.maxLift || t.medianEndPct > 0) return out(S.WARN, `×${lift(t.lift)}`, `${txt} Eticheta nu descurajează suficient (prag lift ≤ ${c.maxLift}, median ≤ 0).`);
    return out(S.PASS, `${pctTxt(t.medianEndPct)}`, txt);
  },

  recallAtLeast(c, f, book) {
    const eff = f.identification?.[c.window];
    if (!eff?.observations) return needData(eff, book, c.window);
    const t = tierOf(eff, c.tier);
    const minMovers = eff.minMovers ?? 20;
    if (eff.movers < minMovers) return out(S.LEARNING, null, `${eff.movers} mișcări de ${windowLabel(book, c.window)} până acum — sub pragul de ${minMovers} (P-3).`);
    const txt = `${tierLabel(c.tier)}: ${t?.n ?? 0} observații, a semnalat ${pctTxt(t?.recallPct)} din ${eff.movers} mișcări de ${windowLabel(book, c.window)} (${eff.moverProjects} proiecte), prag ${c.minPct}%.`;
    if (isNum(t?.recallPct) && t.recallPct >= c.minPct) return out(S.PASS, pctTxt(t.recallPct), txt);
    // Only tiers that still answer the question "early": the late stage is never recommended.
    const best = bestTier(eff, { exclude: ['IGNORE', 'WATCH', 'STAGE0', 'STAGE3', c.tier, 'ANSWER'], minRecallPct: c.minPct });
    const variant = tierOf(eff, 'EARLY_STAGE12');
    const parts = [];
    if (variant?.ready && isNum(variant.liftLo) && variant.liftLo > 1) parts.push(`varianta „${variant.label}” ar fi prins ${pctTxt(variant.recallPct)} din mișcări, cu lift ${lift(variant.lift)} (limita inferioară ${lift(variant.liftLo)})`);
    if (best && best.id !== variant?.id) parts.push(`cel mai bun nivel măsurat, „${best.label}”, ${pctTxt(best.recallPct)} cu lift ${lift(best.lift)} (limita inferioară ${lift(best.liftLo)})`);
    const rec = parts.length ? `Cu dovezi, iar decizia rămâne a proprietarului (P-5): ${parts.join('; ')}.` : 'Niciun nivel măsurat nu are încă un avantaj sigur; definiția rămâne, iar agentul continuă să măsoare.';
    return out(S.WARN, pctTxt(t?.recallPct ?? 0), txt, rec);
  },

  forecastEvent(c, f) {
    const fc = f.forecast;
    if (!fc) return out(S.UNKNOWN, null, 'Snapshot-ul nu are prognoza.');
    const r = (fc.baseRates ?? []).find((b) => b.multiple === 100);
    if (!fc.event || !isNum(r?.annualPct)) return out(S.WARN, null, 'Prognoza nu declară evenimentul de la prețul zilei: rata „de la minim la vârf” supraevaluează probabilitatea pe care o vede investitorul.', 'motorul prognozei trebuie actualizat la rata de bază pe zi.');
    return out(S.PASS, `${r.pct}% / zi`, `Eveniment: „${fc.event}”. ≥100×: ${r.pct}% pentru o zi oarecare = anual ${r.annualPct}% × partea din an din care mișcarea era accesibilă (~${r.qualifyingDaysMean ?? '—'} zile, măsurată la ${r.qualifyingMeasured ?? 0} câștigători).`);
  },

  noLookAhead(c, f) {
    const fc = f.forecast;
    if (!fc) return out(S.UNKNOWN, null, 'Snapshot-ul nu are prognoza.');
    const confirmed = (fc.winners ?? []).filter((w) => w.status === 'CONFIRMED');
    if (!confirmed.length) return out(S.LEARNING, null, 'Niciun câștigător confirmat încă.');
    const bad = confirmed.filter((w) => w.anchorAt && w.low?.at && w.anchorAt > w.low.at);
    if (bad.length) return out(S.FAIL, bad.map((w) => w.symbol).join(', '), `Amprentă măsurată după minim la ${bad.map((w) => w.symbol).join(', ')} — date din viitor.`, 'regula point-in-time (P-1) este încălcată; testele de domeniu ale prognozei trebuie să o prindă.');
    return out(S.PASS, `${confirmed.length} verificați`, `Toți cei ${confirmed.length} câștigători confirmați au amprenta măsurată cel târziu în ziua minimului.`);
  },

  annualPlausible(c, f) {
    const fc = f.forecast;
    if (!fc) return out(S.UNKNOWN, null, 'Snapshot-ul nu are prognoza.');
    const r = (fc.baseRates ?? []).find((b) => b.multiple === c.target);
    if (!isNum(r?.annualPct)) return out(S.LEARNING, null, `Rata anuală ≥${c.target}× nu este încă publicată.`);
    const txt = `Frecvența anuală ≥${c.target}×: ${r.annualPct}% (interval ${r.annualLo ?? '—'}–${r.annualHi ?? '—'}%) din ${r.population ?? '—'} proiecte urmărite, ${r.events ?? '—'} evenimente.`;
    if (r.annualPct > 0 && r.annualPct <= c.maxPct) return out(S.PASS, `${r.annualPct}%/an`, txt);
    return out(S.WARN, `${r.annualPct}%/an`, `${txt} În afara intervalului plauzibil (0–${c.maxPct}%).`, 'verificați populația urmărită și lista de învățare (bias de supraviețuire).');
  },

  looSkill(c, f) {
    const fc = f.forecast;
    if (!fc) return out(S.UNKNOWN, null, 'Snapshot-ul nu are prognoza.');
    const id = fc.model?.identification?.[String(c.target)];
    if (!id) return out(S.UNKNOWN, null, 'Prognoza publicată nu are validarea în afara eșantionului.');
    if (!id.ready) return out(S.LEARNING, isNum(id.recallTop20) ? `${id.recallTop20}%` : null, `${id.n} câștigători ≥${c.target}× — sub pragul de ${fc.model?.minLooWinners ?? 8} pentru o validare (P-3).`);
    const off = fc.model?.fingerprintOff?.[String(c.target)];
    const txt = `≥${c.target}×: ${id.recallTop20}% din cei ${id.n} câștigători, scoși pe rând din învățare, ies în top 20% al universului (aleator: 20%; mediana percentilei ${id.medianPercentile ?? '—'}).`;
    if (id.recallTop20 >= c.passPct) return out(S.PASS, `${id.recallTop20}%`, txt);
    if (id.recallTop20 >= c.warnPct) return out(S.WARN, `${id.recallTop20}%`, `${txt} Sub pragul de ${c.passPct}% (dublul întâmplării).`);
    return out(S.WARN, `${id.recallTop20}%`, `${txt} Fără putere de separare: ${off ? 'motorul a oprit singur ajustarea și publică rata de bază' : 'ajustarea ar trebui oprită'}.`, 'trăsăturile amprentei nu deosebesc câștigătorii; revizuiți-le înainte de a reporni ajustarea.');
  },

  calibrationInterim(c, f) {
    const cal = f.calibration;
    const i = cal?.interim?.[String(c.target)];
    if (!cal?.predictions) return out(S.LEARNING, null, 'Registrul prognozelor începe cu prima cohortă săptămânală.');
    if (!i || !(i.expected >= 3)) return out(S.LEARNING, `${i?.observed ?? 0}/${round(i?.expected ?? 0, 2)}`, `Așteptate până acum ${round(i?.expected ?? 0, 2)} creșteri ≥${c.target}×, observate ${i?.observed ?? 0} — prea puține pentru un verdict (P-3).`);
    const txt = `≥${c.target}×: observate ${i.observed}, așteptate ${round(i.expected, 1)} (raport ${round(i.ratio, 2)}, interval 90% ${round(i.lower, 2)}–${round(i.upper, 2)}).`;
    return i.lower <= 1 && i.upper >= 1 ? out(S.PASS, `×${round(i.ratio, 2)}`, txt) : out(S.WARN, `×${round(i.ratio, 2)}`, txt, i.ratio > 1 ? 'prognoza subestimează: rata de bază prudentă poate fi prea mică.' : 'prognoza supraestimează: lista de învățare are bias de supraviețuire.');
  },

  calibrationMature(c, f) {
    const cal = f.calibration;
    const sk = cal?.skill?.[String(c.target)];
    if (!cal?.matured || !isNum(sk)) return out(S.LEARNING, null, `Prima cohortă ajunge la scadența de 12 luni ${cal?.cohorts ? 'după un an de la înregistrare' : 'după ce este înregistrată'}; până atunci scorul Brier nu se poate calcula.`);
    const txt = `La scadență: Brier ≥${c.target}× ${cal.brier?.[String(c.target)]}, față de rata de bază ${cal.brierBase?.[String(c.target)]} (skill ${sk}).`;
    return sk >= 0 ? out(S.PASS, `skill ${sk}`, txt) : out(S.WARN, `skill ${sk}`, txt, 'ajustarea pe amprentă adaugă zgomot; mărirea shrinkK o apropie de rata de bază.');
  },

  learningList(c, f) {
    const fc = f.forecast;
    if (!fc) return out(S.UNKNOWN, null, 'Snapshot-ul nu are prognoza.');
    const n = (fc.winners ?? []).filter((w) => w.status === 'CONFIRMED').length;
    const total = (fc.winners ?? []).length;
    const txt = `${n} din ${total} câștigători din lista de învățare confirmați din istoricul zilnic.`;
    return n >= c.minConfirmed ? out(S.PASS, `${n}/${total}`, txt) : out(S.WARN, `${n}/${total}`, `${txt} Sub pragul de ${c.minConfirmed}.`, 'normal în primele rulări: istoricul se citește treptat, în bugetul gratuit.');
  },

  selfSkill(c, f) {
    const s = f.selfEval;
    if (!s) return out(S.UNKNOWN, null, 'Auto-evaluarea nu a rulat.');
    if (!(s.runsScored >= c.minRuns)) return out(S.LEARNING, s.runsScored ? `${s.runsScored} rulări` : null, `${s.runsScored ?? 0} rulări notate din ${c.minRuns} necesare pentru un verdict (P-3); ${s.predictions ?? 0} predicții notate până acum.`);
    const base = `Pe ${s.runsScored} rulări (${s.predictions} predicții): Brier ${s.brier} față de ${s.brierPersistence} pentru „ca data trecută” și ${s.brierClimatology} pentru frecvența simplă`;
    if (!s.comparable) {
      const v = s.skillVsClimatology;
      const txt = `${base}; doar ${s.changes} schimbări de stare (sub ${s.minChanges}), deci regula naivă nu poate fi încă bătută — comparația se face cu frecvența simplă: skill ${v}.`;
      return isNum(v) && round(v, 2) < c.min ? out(S.WARN, `skill ${v}`, txt, 'agentul anticipează mai prost decât frecvența simplă: lanțul de stări învățat este instabil.') : out(S.PASS, isNum(v) ? `skill ${v}` : null, txt);
    }
    const txt = `${base} → skill ${s.skill} pe ${s.changes} schimbări de stare.`;
    return round(s.skill, 2) >= c.min ? out(S.PASS, `skill ${s.skill}`, txt) : out(S.WARN, `skill ${s.skill}`, txt, 'memoria nu anticipează mai bine decât regula naivă: tranzițiile porților se schimbă mai repede decât le învață agentul; mărirea ferestrei sau a priorului le stabilizează.');
  },


  normMaturity(c, f) {
    const rows = f.norms ?? [];
    if (!rows.length) return out(S.LEARNING, null, 'Nicio metrică urmărită încă.');
    const learned = rows.filter((r) => r.status !== 'LEARNING').length;
    const share = learned / rows.length;
    const txt = `${learned} din ${rows.length} metrici au destule observații pentru o normă (${pctTxt(share * 100, 0)}).`;
    return share >= c.minShare ? out(S.PASS, `${learned}/${rows.length}`, txt) : out(S.LEARNING, `${learned}/${rows.length}`, `${txt} Normele se completează cu fiecare rulare.`);
  },

  gate(c, f) {
    if (RULE_GATES.includes(c.gate)) return out(S.UNKNOWN, null, `Regula nu poate depinde de o poartă derivată din reguli (${c.gate}).`);
    const g = f.gates?.find((x) => x.id === c.gate);
    if (!g) return out(S.UNKNOWN, null, `Poarta ${c.gate} nu a fost evaluată.`);
    return out(g.status, g.value ?? null, `${g.title}: ${g.evidence}`);
  },
};

/**
 * Evaluate the whole rulebook.
 * @param {any} book  the parsed rules.json
 * @param {{identification?:Record<string,any>, forecast?:any, calibration?:any, selfEval?:any, norms?:any[], gates?:any[]}} facts
 */
export function evaluateRules(book, facts = {}) {
  const problems = validateRulebook(book);
  const results = (book?.rules ?? []).map((r) => {
    let o;
    try {
      o = CHECKS[r.check?.type] ? CHECKS[r.check.type](r.check, facts, book) : out(S.UNKNOWN, null, `Verificare necunoscută „${r.check?.type}”.`);
    } catch (err) {
      o = out(S.UNKNOWN, null, `Evaluare eșuată: ${String(err?.message ?? err).slice(0, 120)}`);
    }
    return { id: r.id, area: r.area, title: r.title, rule: r.rule, why: r.why ?? null, check: r.check?.type ?? null, ...o };
  });
  const counts = Object.fromEntries(Object.values(S).map((s) => [s, results.filter((x) => x.status === s).length]));
  return {
    version: book?.version ?? null,
    hash: book ? rulebookHash(book) : null,
    title: book?.title ?? null,
    updatedAt: book?.updatedAt ?? null,
    problems,
    counts,
    total: results.length,
    areas: AREAS.map((a) => ({ ...a, counts: Object.fromEntries(Object.values(S).map((s) => [s, results.filter((x) => x.area === a.id && x.status === s).length])) })),
    results,
    recommendations: results.filter((x) => x.recommendation && x.status !== S.PASS).map((x) => ({ id: x.id, title: x.title, text: x.recommendation })),
  };
}

/**
 * The rulebook in the agent's memory: version and fingerprint, and every change of them with its time.
 */
export function rememberRulebook(knowledge, book, nowIso) {
  const hash = book ? rulebookHash(book) : null;
  const prev = knowledge ?? null;
  const changes = [...(prev?.changes ?? [])];
  if (hash && prev?.hash !== hash) changes.push({ at: nowIso, from: prev?.version ?? null, to: book.version ?? null, hash, previousHash: prev?.hash ?? null });
  return {
    version: book?.version ?? prev?.version ?? null,
    hash: hash ?? prev?.hash ?? null,
    rules: book?.rules?.length ?? prev?.rules ?? 0,
    loadedAt: book ? nowIso : prev?.loadedAt ?? null,
    since: changes[0]?.at ?? prev?.since ?? null,
    changes: changes.slice(-20),
  };
}

/** One point per rule per run: [time, status code, value when it is a number]. Bounded. */
export function recordRuleHistory(history, evaluation, tMs, maxPoints = 120) {
  const h = { ...(history ?? {}) };
  for (const r of evaluation?.results ?? []) {
    // The first number of the displayed value (a lift, a share, a skill) is the rule's trend line.
    const m = typeof r.value === 'string' ? /-?\d+(?:\.\d+)?/.exec(r.value) : null;
    const num = m ? Number(m[0]) : null;
    const pts = [...(h[r.id] ?? []), [tMs, RULE_CODE[r.status] ?? 'U', Number.isFinite(num) ? num : null]];
    h[r.id] = pts.length > maxPoints ? pts.slice(pts.length - maxPoints) : pts;
  }
  return h;
}

/** Per rule: how its verdict evolved (runs per status, the last change). */
export function ruleTrends(history, evaluation, { last = 24 } = {}) {
  return (evaluation?.results ?? []).map((r) => {
    const pts = history?.[r.id] ?? [];
    const recent = pts.slice(-last);
    const by = Object.fromEntries(Object.entries(RULE_CODE).map(([s, c]) => [s, recent.filter((p) => p[1] === c).length]));
    let changedAt = null;
    for (let i = pts.length - 1; i > 0; i -= 1) {
      if (pts[i][1] !== pts[i - 1][1]) {
        changedAt = pts[i][0];
        break;
      }
    }
    return { id: r.id, runs: pts.length, recent: recent.length, by, changedAt: isNum(changedAt) ? new Date(changedAt).toISOString() : null, values: recent.map((p) => p[2]).filter(isNum) };
  });
}
