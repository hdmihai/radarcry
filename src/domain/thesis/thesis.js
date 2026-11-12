/**
 * THESIS BUILDER — the object a web3 researcher actually reads.
 *
 * Every number in this project exists to support one readable paragraph: what appears to be
 * happening, on what evidence, what would confirm it, what would kill it, and how late we are. That
 * paragraph is assembled here, in Romanian, from the engines' output — never written by hand and
 * never asserting anything that is not already in a factor with a source.
 */
import { isNum, round } from '../shared/math.js';
import { STAGE, STAGE_LABEL_RO } from '../discovery/classify.js';
import { confidenceLabel } from '../quality/data-quality.js';

const money = (x) => {
  if (!isNum(x)) return 'necunoscut';
  if (Math.abs(x) >= 1e9) return `${round(x / 1e9, 2)} mld $`;
  if (Math.abs(x) >= 1e6) return `${round(x / 1e6, 1)} mil $`;
  if (Math.abs(x) >= 1e3) return `${round(x / 1e3, 0)} mii $`;
  return `${round(x, 2)} $`;
};

const pct = (x, digits = 1) => (isNum(x) ? `${x > 0 ? '+' : ''}${round(x, digits)}%` : 'necunoscut');

/**
 * WHO IS BUYING — a compact read of on-chain flow direction and quality.
 * Pure function: reads asset.onchain.{smartMoney,flows}, no I/O.
 */
function whoIsBuyingSection(asset) {
  const sm = asset.onchain?.smartMoney;
  const flows = asset.onchain?.flows;

  if (!flows && !sm?.components?.length) {
    return {
      verdict: 'UNKNOWN',
      headline: 'Date on-chain insuficiente în această rulare',
      buyers: [],
      sellers: [],
      confidence: 0,
      sources: [],
    };
  }

  const buyers = [];
  const sellers = [];

  if (flows && flows.verdict && flows.verdict !== 'UNKNOWN') {
    if (isNum(flows.newWhales) && flows.newWhales > 0) {
      buyers.push({
        label: `${flows.newWhales} portofele mari noi`,
        evidence: flows.verdict === 'ACCUMULATING' ? (flows.verdictLabel ?? null) : null,
        source: 'holder-flows',
      });
    }
    if (isNum(flows.accumulating) && flows.accumulating > 0) {
      buyers.push({
        label: `${flows.accumulating} portofele acumulează`,
        evidence: flows.verdict === 'ACCUMULATING' ? (flows.verdictLabel ?? null) : null,
        source: 'holder-flows',
      });
    }
    if (isNum(flows.distributing) && flows.distributing > 0) {
      sellers.push({
        label: `${flows.distributing} portofele distribuie`,
        evidence: flows.verdict === 'DISTRIBUTING' ? (flows.verdictLabel ?? null) : null,
        source: 'holder-flows',
      });
    }
    if (isNum(flows.cexDeltaPct) && flows.cexDeltaPct > 0) {
      sellers.push({
        label: 'intrări nete pe CEX',
        evidence: `+${round(flows.cexDeltaPct * 100, 1)}%`,
        source: 'holder-flows',
      });
    }
    if (isNum(flows.cexDeltaPct) && flows.cexDeltaPct < 0) {
      buyers.push({
        label: 'ieșiri nete din CEX',
        evidence: `${round(flows.cexDeltaPct * 100, 1)}%`,
        source: 'holder-flows',
      });
    }
  }

  for (const c of (sm?.components ?? []).slice(0, 4)) {
    buyers.push({
      label: c.label ?? c.key ?? 'semn',
      evidence: c.evidence ?? (isNum(c.points) ? `${round(c.points, 1)} puncte` : null),
      source: 'smart-money',
    });
  }
  for (const p of (sm?.penalties ?? []).slice(0, 3)) {
    sellers.push({
      label: p.label ?? p.key ?? 'penalizare',
      evidence: isNum(p.points) ? `${round(p.points, 0)} puncte` : null,
      source: 'smart-money',
    });
  }

  let verdict;
  if (flows?.verdict === 'ACCUMULATING') verdict = 'ACCUMULATING';
  else if (flows?.verdict === 'DISTRIBUTING') verdict = 'DISTRIBUTING';
  else if (buyers.length > sellers.length) verdict = 'ACCUMULATING';
  else if (sellers.length > buyers.length) verdict = 'DISTRIBUTING';
  else if (buyers.length && sellers.length) verdict = 'MIXED';
  else if (buyers.length) verdict = 'ACCUMULATING';
  else if (sellers.length) verdict = 'DISTRIBUTING';
  else verdict = 'UNKNOWN';

  let headline;
  if (verdict === 'ACCUMULATING') {
    headline = `${buyers.length} semnale de acumulare, ${sellers.length} de distribuție`;
  } else if (verdict === 'DISTRIBUTING') {
    headline = `${sellers.length} semnale de distribuție domină`;
  } else if (verdict === 'MIXED') {
    headline = `Semne mixte: ${buyers.length} acumulare, ${sellers.length} distribuție`;
  } else {
    headline = 'Date on-chain insuficiente';
  }

  let confidence;
  if (isNum(sm?.coverage)) confidence = Math.round(sm.coverage * 100);
  else if (flows) confidence = 40;
  else confidence = 0;

  const sources = [];
  if (flows) sources.push('holder-flows');
  if (sm) {
    sources.push('smart-money');
    if (isNum(sm.measured)) sources.push(`${sm.measured}/16 componente`);
  }

  return { verdict, headline, buyers, sellers, confidence, sources };
}

/**
 * IS THE MOVE HEALTHY — quality of the price move: supported by volume/structure vs speculative/distribution.
 * Pure: reads asset.features.daily (candles), asset.derived.turnover (universe), asset.onchain.flows.verdict.
 */
function isMoveHealthySection(asset) {
  const daily = asset.features?.daily;
  const turnover = asset.derived?.turnover;
  const flowsVerdict = asset.onchain?.flows?.verdict;

  if (!daily) {
    return {
      verdict: 'UNKNOWN',
      headline: 'Date de preț insuficiente în această rulare',
      signals: [],
      confidence: 0,
      sources: [],
    };
  }

  const signals = [
    { key: 'volAccel',   label: 'accelerare volum',    value: daily.volAccel,   healthy: isNum(daily.volAccel) && daily.volAccel > 1.2,                                       source: 'price-features' },
    { key: 'upVolRatio', label: 'volum pe creștere',   value: daily.upVolRatio, healthy: isNum(daily.upVolRatio) && daily.upVolRatio >= 0.55,                              source: 'price-features' },
    { key: 'rsi14',      label: 'RSI 14',              value: daily.rsi14,      healthy: isNum(daily.rsi14) && daily.rsi14 >= 40 && daily.rsi14 <= 70,                       source: 'price-features' },
    { key: 'rangePos30', label: 'poziție în range 30', value: daily.rangePos30, healthy: isNum(daily.rangePos30) && daily.rangePos30 >= 0.4 && daily.rangePos30 <= 0.85, source: 'price-features' },
    { key: 'dd30',       label: 'drawdown 30d',        value: daily.dd30,       healthy: isNum(daily.dd30) && daily.dd30 > -25,                                              source: 'price-features' },
    { key: 'turnover',   label: 'turnover',            value: turnover,         healthy: isNum(turnover) && turnover >= 0.05 && turnover <= 0.5,                            source: 'universe'      },
  ];

  const dataCount = signals.filter((s) => isNum(s.value)).length;
  const healthyCount = signals.filter((s) => s.healthy).length;

  let verdict;
  if (flowsVerdict === 'DISTRIBUTING') {
    verdict = 'DISTRIBUTION';
  } else if (isNum(turnover) && turnover > 0.5 && isNum(daily.volAccel) && daily.volAccel > 3) {
    verdict = 'SPECULATIVE';
  } else if (healthyCount >= 4 && isNum(daily.rsi14) && daily.rsi14 < 75 && isNum(daily.dd30) && daily.dd30 > -25) {
    verdict = 'HEALTHY';
  } else {
    verdict = 'FRAGILE';
  }

  let headline;
  if (verdict === 'DISTRIBUTION') {
    headline = 'Fluxuri on-chain indică distribuție — mișcarea nu e susținută';
  } else if (verdict === 'SPECULATIVE') {
    headline = `Volum exploziv (${round(daily.volAccel, 1)}x) fără structură — speculativ`;
  } else if (verdict === 'HEALTHY') {
    headline = `${healthyCount}/6 semnale sănătoase — mișcare susținută`;
  } else {
    headline = `${healthyCount}/6 semnale sănătoase — mișcare fragilă`;
  }

  const confidence = Math.round((dataCount / signals.length) * 100);
  const sources = ['price-features'];
  if (isNum(turnover)) sources.push('universe');
  if (flowsVerdict) sources.push('holder-flows');

  return { verdict, headline, signals, confidence, sources };
}

/**
 * @param {{asset:any, verdict:any, changed:any, pre:any, risk:any, market:any, levels:any}} input
 * @returns {{headline:string, paragraph:string, whatChanged:any[], confirms:any[], invalidates:any[],
 *   timing:string, confidenceLabel:string, oneLiner:string, questionAnswer:any}}
 */
export function buildThesis({ asset, verdict, changed, pre, risk, market, levels }) {
  const m = asset.market ?? {};
  const name = `${asset.name} (${asset.symbol})`;

  /* ── headline ──────────────────────────────────────────────────────────────────────────────── */
  const headline = verdict.earlyResearchCandidate
    ? `${name}: ${changed.count} schimbări importante în ${changed.familyCount} familii, încă neevidente`
    : verdict.stage >= STAGE.EXPANSION
      ? `${name}: mișcare deja în desfășurare (${STAGE_LABEL_RO[verdict.stage].toLowerCase()})`
      : `${name}: ${verdict.bandLabel.toLowerCase()}`;

  /* ── the paragraph ─────────────────────────────────────────────────────────────────────────── */
  const bits = [];
  bits.push(`${name} are o capitalizare de ${money(m.marketCap)} și un volum de ${money(m.volume24h)} pe 24 de ore`);
  if (isNum(asset.derived?.turnover)) bits.push(`o rotație de ${round(asset.derived.turnover * 100, 1)}% din capitalizare pe zi`);
  const changesPart = changed.count
    ? `Peste propria normă de 30 de zile ${changed.count === 1 ? 's-a schimbat un lucru' : `s-au schimbat ${changed.count} lucruri`}, în ${changed.familyCount} ${changed.familyCount === 1 ? 'familie de factori' : 'familii distincte de factori'}: ${changed.changes.slice(0, 4).map((c) => `${c.label.toLowerCase()} (${c.detail})`).join('; ')}.`
    : 'Nimic nu s-a schimbat semnificativ peste propria normă de 30 de zile.';
  // Standing conditions are context for the thesis, never part of the count: a hot sector or a mostly
  // circulating float supports a reading, but nothing about them is moving.
  const conditions = changed.conditions ?? [];
  const contextPart = conditions.length
    ? `Context favorabil, care nu se numără ca schimbare: ${conditions.map((c) => `${c.label.toLowerCase()} (${c.detail})`).join('; ')}.`
    : '';
  const earlyPart = isNum(changed.earliness)
    ? `Precocitatea este ${changed.earliness}/100: ${changed.earliness >= 65 ? 'mișcarea nu este încă evidentă public' : changed.earliness >= 40 ? 'o parte a mișcării este deja vizibilă' : 'mișcarea este în mare parte deja făcută'} (preț ${pct(m.change?.d30)} pe 30 de zile, ${pct(m.change?.d7)} pe 7 zile).`
    : '';
  const scorePart = isNum(pre?.score)
    ? `Scorul de pre-expansiune este ${round(pre.score, 1)}/100 (${pre.bandLabel.toLowerCase()}), cu o încredere de ${pre.confidence}% — ${pre.missing.length ? `${pre.missing.length} factori nu au putut fi măsurați și au fost scoși din ponderare, nu penalizați` : 'toți cei opt factori au putut fi măsurați'}.`
    : 'Scorul de pre-expansiune nu poate fi raportat: prea puțini factori măsurabili în această rulare.';
  const riskPart = isNum(risk?.score)
    ? `Riscul agregat este ${risk.score}/100 (${risk.level.toLowerCase()}), dominat de: ${risk.top.map((r) => r.label.toLowerCase()).join('; ')}.`
    : 'Riscul nu a putut fi agregat.';
  const regimePart = market?.regime ? `Contextul general de piață: ${market.regime.label ?? market.regime.state}${isNum(market.altseason?.value) ? `, indice altseason ${Math.round(market.altseason.value)}/100` : ''}.` : '';

  const paragraph = [`${bits.join(', ')}.`, changesPart, contextPart, earlyPart, scorePart, riskPart, regimePart].filter(Boolean).join(' ');

  /* ── what would confirm ────────────────────────────────────────────────────────────────────── */
  const confirms = [];
  if (!changed.simultaneous) {
    confirms.push({ label: 'Confluență peste prag', detail: 'cel puțin 3 schimbări importante în minimum 2 familii distincte, în aceeași fereastră de 7 zile', where: 'secțiunea „Ce s-a schimbat”' });
  }
  const flows = asset.onchain?.flows;
  if (!flows || !['ACCUMULATION'].includes(flows.verdict)) {
    confirms.push({ label: 'Acumulare confirmată on-chain', detail: 'minimum 5 portofele mari în creștere, fără depozite nete către burse centralizate', where: 'lista clasificată de deținători, la fiecare rulare completă' });
  }
  if (!isNum(asset.onchain?.holders)) {
    confirms.push({ label: 'Lista de deținători devine disponibilă', detail: 'un lanț acoperit de furnizorii gratuiți (BSC, Solana, Base, Ethereum, Arbitrum)', where: 'secțiunea „Acoperire surse”' });
  }
  if (isNum(levels?.rr1) && levels.rr1 < 2) {
    confirms.push({ label: 'Raport câștig/risc de minimum 2', detail: `acum ${round(levels.rr1, 2)} — este nevoie de o retragere spre zona de intrare sau de un obiectiv mai departe`, where: 'nivele de research' });
  }
  if (asset.futures?.grade?.grade === 'NO_TRADE' && asset.futures?.trend?.regime) {
    confirms.push({ label: 'Structura 1D se repară', detail: `regimul zilnic este ${asset.futures.trend.regime.toLowerCase().replace('_', ' ')}; LONG-ul redevine permis la o revenire peste EMA50`, where: 'Futures Radar' });
  }
  if (!confirms.length) confirms.push({ label: 'Persistența semnalului', detail: 'aceleași schimbări confirmate la următoarea rulare completă, fără creșterea evidenței publice', where: 'istoricul propriu al proiectului' });

  /* ── timing ────────────────────────────────────────────────────────────────────────────────── */
  const timing = verdict.earlyResearchCandidate
    ? `Fereastră de research deschisă: Stage ${verdict.stage} (${verdict.stageLabel.toLowerCase()}), precocitate ${changed.earliness}/100.`
    : verdict.stage === STAGE.CROWDED
      ? 'Fereastra de research timpuriu este închisă: mișcarea este publică și poziționarea este aglomerată.'
      : verdict.stage === STAGE.EXPANSION
        ? 'Mișcarea este în desfășurare; de aici înainte raportul risc/randament se degradează cu fiecare zi.'
        : verdict.stage === STAGE.DORMANT
          ? 'Nicio fereastră: proiectul este latent, de ținut în monitorizare.'
          : 'Semnal incipient: una sau două schimbări, insuficiente pentru o teză.';

  const oneLiner = verdict.earlyResearchCandidate
    ? `${asset.symbol}: ${changed.count} ${changed.simultaneous ? 'schimbări simultane' : `${changed.count === 1 ? 'schimbare' : 'schimbări'} în ${changed.familyCount} ${changed.familyCount === 1 ? 'familie' : 'familii'}`}, oportunitate ${round(pre.score, 0)}, risc ${risk.score}, precocitate ${changed.earliness} — candidat de research timpuriu.`
    : `${asset.symbol}: ${verdict.verdict.split('—')[0].trim().toLowerCase()}, oportunitate ${isNum(pre?.score) ? round(pre.score, 0) : '—'}, risc ${isNum(risk?.score) ? risk.score : '—'}.`;

  /* ── the literal answer to the project's question ──────────────────────────────────────────── */
  const questionAnswer = {
    question: 'Arată-mi proiectele mici unde se schimbă simultan mai multe lucruri importante, înainte ca mișcarea să devină evidentă, și spune-mi ce riscuri pot invalida această ipoteză.',
    small: isNum(m.marketCap) ? `capitalizare ${money(m.marketCap)}` : 'capitalizare necunoscută',
    simultaneous: changed.simultaneous
      ? `da — ${changed.count} schimbări în ${changed.familyCount} familii (confluență ${changed.confluence})`
      : `nu — ${changed.count} schimbări în ${changed.familyCount} ${changed.familyCount === 1 ? 'familie' : 'familii'}, sub pragul de 3 schimbări în 2 familii`,
    notYetObvious: isNum(changed.earliness)
      ? `precocitate ${changed.earliness}/100 (evidență publică ${changed.obviousness}/100)`
      : 'nedeterminat',
    risksThatInvalidate: (risk?.invalidators ?? []).slice(0, 5).map((r) => ({ label: r.label, severity: r.severity, invalidates: r.invalidates, watch: r.watch })),
    verdict: verdict.verdict,
  };

  return {
    headline,
    paragraph,
    whatChanged: changed.changes,
    context: conditions,
    confirms,
    invalidates: (risk?.invalidators ?? []).map((r) => ({ label: r.label, severity: r.severity, category: r.category, invalidates: r.invalidates, watch: r.watch })),
    whoIsBuying: whoIsBuyingSection(asset),
    isMoveHealthy: isMoveHealthySection(asset),
    timing,
    confidenceLabel: confidenceLabel(pre?.confidence ?? null),
    oneLiner,
    questionAnswer,
  };
}
