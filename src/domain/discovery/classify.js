/**
 * LIFECYCLE STAGE AND THE EARLY RESEARCH CANDIDATE.
 *
 * Stage 0 Dormant                  — nothing is moving above the token's own norm
 * Stage 1 Early activity           — one or two things changed, quietly
 * Stage 2 Multi-factor confirmation— several things changed at once, still not obvious
 * Stage 3 Expansion                — the move is under way and visible
 * Stage 4 Crowded                  — everyone can see it; funding, attention and price say so
 *
 * The attachment's definition of the thing this project exists to find is reproduced exactly:
 *
 *   Early Research Candidate = Stage 1–2  AND  Opportunity > 75  AND  Risk < 60
 *
 * Nothing else is added to that test. Momentum and earliness are reported *beside* the score, not
 * folded into it, because the LAB case in the attachment needs both numbers to be visible at once:
 * a token already up 400 % scores momentum 98 and early discovery 35 — excellent and too late.
 */
import { clamp, isNum, round } from '../shared/math.js';

export const STAGE = {
  DORMANT: 0,
  EARLY_ACTIVITY: 1,
  MULTI_FACTOR: 2,
  EXPANSION: 3,
  CROWDED: 4,
};

export const STAGE_LABEL_RO = {
  0: 'Latent',
  1: 'Activitate timpurie',
  2: 'Confirmare multi-factor',
  3: 'Expansiune',
  4: 'Aglomerat',
};

export const STAGE_MEANING_RO = {
  0: 'nimic nu se mișcă peste propria normă a proiectului',
  1: 'una sau două lucruri s-au schimbat, discret',
  2: 'mai multe lucruri s-au schimbat simultan, iar mișcarea nu este încă evidentă',
  3: 'mișcarea este în desfășurare și vizibilă public',
  4: 'toată lumea o vede: funding, atenție și preț o confirmă',
};

/** Early Research Candidate thresholds — from the technical solution, unmodified. */
export const EARLY_CANDIDATE = { stages: [1, 2], minOpportunity: 75, maxRisk: 60 };

/**
 * MOMENTUM (0..100) — how strong the move already is. High momentum is not the goal; it is the
 * context against which earliness is read.
 */
export function momentumScore(asset) {
  const m = asset.market ?? {};
  const d = asset.features?.daily ?? {};
  let s = 50;
  const ch7 = m.change?.d7;
  const ch30 = m.change?.d30;
  if (isNum(ch7)) s += clamp(ch7 / 2.5, -20, 22);
  if (isNum(ch30)) s += clamp(ch30 / 8, -18, 26);
  if (isNum(d.volAccel)) s += clamp((d.volAccel - 1) * 9, -10, 16);
  if (isNum(d.rangePos30)) s += (d.rangePos30 - 0.5) * 18;
  if (d.breakout30 === true) s += 6;
  if (isNum(d.r2_30) && isNum(d.slope30) && d.slope30 > 0) s += d.r2_30 * 8;
  return round(clamp(s, 0, 100), 1);
}

/**
 * Assign a lifecycle stage. The inputs are the confluence view (how many families changed) and the
 * obviousness of the move — precisely the two axes the question asks about.
 */
export function stageOf({ changed, momentum, asset }) {
  const count = changed?.count ?? 0;
  const families = changed?.familyCount ?? 0;
  const obvious = changed?.obviousness ?? 0;
  const funding = asset?.derivatives?.fundingPct8h;
  const crowdedFunding = isNum(funding) && funding >= 0.015;
  const trending = asset?.attention?.cgTrending === true || asset?.attention?.gtTrending === true;

  if (obvious >= 72 || (crowdedFunding && obvious >= 55) || (trending && obvious >= 60)) return STAGE.CROWDED;
  if (obvious >= 45 || (isNum(momentum) && momentum >= 72 && obvious >= 35)) return STAGE.EXPANSION;
  if (count >= 3 && families >= 2) return STAGE.MULTI_FACTOR;
  if (count >= 1) return STAGE.EARLY_ACTIVITY;
  return STAGE.DORMANT;
}

/**
 * The final per-asset verdict object.
 *
 * @param {{asset:any, pre:any, risk:any, changed:any}} input
 * @returns {{stage:number, stageLabel:string, stageMeaning:string, opportunity:number|null,
 *   momentum:number, earliness:number, risk:number|null, confidence:number,
 *   earlyResearchCandidate:boolean, answersQuestion:boolean, verdict:string, why:string[], tests:any[]}}
 */
export function classify({ asset, pre, risk, changed }) {
  const momentum = momentumScore(asset);
  const stage = stageOf({ changed, momentum, asset });
  const opportunity = pre?.score ?? null;
  const riskScore = risk?.score ?? null;
  const earliness = changed?.earliness ?? null;

  const tests = [
    { key: 'stage', label: `Stage ${stage} (${STAGE_LABEL_RO[stage]})`, want: 'Stage 1 sau 2', pass: EARLY_CANDIDATE.stages.includes(stage) },
    { key: 'opportunity', label: `Oportunitate ${isNum(opportunity) ? round(opportunity, 1) : '—'}`, want: '> 75', pass: isNum(opportunity) && opportunity > EARLY_CANDIDATE.minOpportunity },
    { key: 'risk', label: `Risc ${isNum(riskScore) ? round(riskScore, 1) : '—'}`, want: '< 60', pass: isNum(riskScore) && riskScore < EARLY_CANDIDATE.maxRisk },
  ];
  const earlyResearchCandidate = tests.every((t) => t.pass);

  const why = [];
  if (changed?.summary) why.push(changed.summary);
  for (const f of (pre?.factors ?? []).slice(0, 3)) if (f.evidence) why.push(`${f.label}: ${f.evidence}`);
  if (isNum(earliness)) why.push(`Precocitate ${earliness}/100 (cât de puțin evidentă este încă mișcarea)`);
  if (riskScore !== null) why.push(`Risc ${round(riskScore, 0)}/100${risk?.top?.length ? ` — dominant: ${risk.top[0].label}` : ''}`);

  let verdict;
  if (earlyResearchCandidate) verdict = 'CANDIDAT DE RESEARCH TIMPURIU — mai multe lucruri importante s-au schimbat simultan, iar mișcarea nu este încă evidentă';
  else if (stage >= STAGE.EXPANSION && isNum(opportunity) && opportunity > 70) verdict = 'MIȘCARE DEJA ÎN DESFĂȘURARE — teză validă, dar descoperită târziu';
  else if (!isNum(opportunity)) verdict = 'DATE INSUFICIENTE — prea puțini factori măsurabili pentru o concluzie';
  else if (stage === STAGE.DORMANT) verdict = 'LATENT — de monitorizat, nimic nu s-a schimbat peste propria normă';
  else verdict = `${pre?.bandLabel ?? 'ÎN OBSERVAȚIE'} — nu întrunește toate cele trei condiții pentru candidat timpuriu`;

  return {
    stage,
    stageLabel: STAGE_LABEL_RO[stage],
    stageMeaning: STAGE_MEANING_RO[stage],
    opportunity,
    band: pre?.band ?? 'UNKNOWN',
    bandLabel: pre?.bandLabel ?? 'NECUNOSCUT',
    momentum,
    earliness,
    risk: riskScore,
    confidence: pre?.confidence ?? 0,
    earlyResearchCandidate,
    // The dashboard's headline filter: the exact shape of the user's question.
    answersQuestion: earlyResearchCandidate && Boolean(changed?.simultaneous),
    verdict,
    why,
    tests,
  };
}

/**
 * Rank candidates for the Small-Cap Radar. Early candidates first, then by the product of
 * opportunity and earliness, so a slightly lower score that is still invisible outranks a higher
 * score everybody already sees.
 */
export function rankCandidates(rows) {
  return [...rows].sort((a, b) => {
    const ac = a.verdict?.earlyResearchCandidate ? 1 : 0;
    const bc = b.verdict?.earlyResearchCandidate ? 1 : 0;
    if (ac !== bc) return bc - ac;
    const av = (a.verdict?.opportunity ?? 0) * (0.55 + 0.45 * ((a.verdict?.earliness ?? 50) / 100)) * (0.6 + 0.4 * ((a.verdict?.confidence ?? 0) / 100));
    const bv = (b.verdict?.opportunity ?? 0) * (0.55 + 0.45 * ((b.verdict?.earliness ?? 50) / 100)) * (0.6 + 0.4 * ((b.verdict?.confidence ?? 0) / 100));
    if (bv !== av) return bv - av;
    return (b.changed?.confluence ?? 0) - (a.changed?.confluence ?? 0);
  });
}
