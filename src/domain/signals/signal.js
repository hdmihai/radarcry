/**
 * Research signals with an explicit, auditable rule set. A signal is a research priority with a
 * structural plan (entry zone, invalidation, targets) — never an order. No execution exists in CRI.
 *
 *  BUY_SETUP  – pre-expansion / early acceleration, strong evidence, LAB/BTW/AGT-like, before hype
 *  ACCUMULATE – base / building phase that matches the analogs: scale-in research zone
 *  WATCH      – interesting but incomplete or conflicting evidence
 *  LATE       – already expanding / hyped: wait for a retest, do not chase
 *  AVOID      – critical risk (cannot sell, extreme tax, exchange warning) or broken structure
 */
import { isNum, round } from '../shared/math.js';
import { STAGE_LABELS } from '../lifecycle/stage.js';
import { HYPE_LABELS } from '../lifecycle/hype.js';

export const SIGNAL_LABELS = {
  BUY_SETUP: 'Setup BUY',
  ACCUMULATE: 'Acumulare',
  WATCH: 'Urmărire',
  LATE: 'Târziu: nu urmări prețul',
  AVOID: 'Evită',
  NONE: '—',
};

/**
 * @param {{cri:number|null, reliability:number, stage:string, hype:string, bestAnalog:number|null,
 *          setupScore:number|null, structure4h:string|null, risk:{critical:boolean, grade:string},
 *          hasCandles:boolean, deep?:boolean, regime:string, conflict:boolean}} c
 * @param {any} cfg signals config
 */
export function classifySignal(c, cfg) {
  const reasons = [];
  const blockers = [];
  const regimePenalty = c.regime === 'RISK_OFF' ? cfg.riskOffPenalty ?? 5 : 0;

  if (c.risk.critical) {
    blockers.push('risc critic de contract/exchange');
    return { type: 'AVOID', label: SIGNAL_LABELS.AVOID, strength: 0, reasons, blockers };
  }
  if (c.stage === 'EXPANSION' || c.hype === 'HYPED') {
    reasons.push(c.stage === 'EXPANSION' ? 'mișcarea a început deja (expansiune)' : 'hype activ');
    return { type: 'LATE', label: SIGNAL_LABELS.LATE, strength: round(c.cri ?? 0, 0), reasons, blockers };
  }
  if (c.stage === 'DECLINE' && c.structure4h === 'BEARISH') {
    blockers.push('trend descendent pe 1D și 4H');
    return { type: 'AVOID', label: SIGNAL_LABELS.AVOID, strength: 0, reasons, blockers };
  }

  const cri = c.cri ?? 0;
  const analog = c.bestAnalog ?? 0;
  const b = cfg.buySetup;
  if (['PRE_EXPANSION', 'ACCELERATION'].includes(c.stage)) {
    const ok = cri >= b.minCri + regimePenalty && analog >= b.minAnalog && c.reliability >= b.minReliability && c.hasCandles && c.structure4h !== 'BEARISH' && ['STEALTH', 'EMERGING', 'UNKNOWN'].includes(c.hype);
    if (ok && c.risk.grade !== 'D') {
      reasons.push(`stadiu: ${STAGE_LABELS[c.stage] ?? c.stage}`, `scor CRI ${cri.toFixed(0)}`, `similaritate ${analog.toFixed(0)}%`, `atenție: ${HYPE_LABELS[c.hype] ?? c.hype}`);
      if (c.conflict) reasons.push('atenție: conflict între domenii');
      return { type: 'BUY_SETUP', label: SIGNAL_LABELS.BUY_SETUP, strength: round((cri + analog) / 2, 0), reasons, blockers };
    }
    if (!c.hasCandles) blockers.push('lipsesc lumânările 1D/4H pentru confirmare');
    if (cri < b.minCri + regimePenalty) blockers.push(`scor CRI sub ${b.minCri + regimePenalty}`);
    if (analog < b.minAnalog) blockers.push(`similaritate sub ${b.minAnalog}%`);
    if (c.reliability < b.minReliability) blockers.push('fiabilitate redusă a datelor');
    if (c.structure4h === 'BEARISH') blockers.push('structură 4H bearish');
    if (c.risk.grade === 'D') blockers.push('risc grad D');
  }
  const a = cfg.accumulate;
  if (c.deep !== false && ['BASE', 'BUILDING', 'PRE_EXPANSION'].includes(c.stage) && cri >= a.minCri + regimePenalty && analog >= a.minAnalog && (c.setupScore ?? 0) >= a.minSetup && c.risk.grade !== 'D') {
    reasons.push(`stadiu: ${STAGE_LABELS[c.stage] ?? c.stage}`, `setup ${c.setupScore?.toFixed(0)}`, `similaritate ${analog.toFixed(0)}%`);
    return { type: 'ACCUMULATE', label: SIGNAL_LABELS.ACCUMULATE, strength: round((cri + analog) / 2, 0), reasons, blockers };
  }
  const w = cfg.watch;
  if (cri >= w.minCri || analog >= w.minAnalog) {
    reasons.push(cri >= w.minCri ? `scor CRI ${cri.toFixed(0)}` : `similaritate ${analog.toFixed(0)}%`);
    return { type: 'WATCH', label: SIGNAL_LABELS.WATCH, strength: round(Math.max(cri, analog * 0.9), 0), reasons, blockers };
  }
  return { type: 'NONE', label: SIGNAL_LABELS.NONE, strength: 0, reasons, blockers };
}

/**
 * Structural research plan from 4H SMC zones and the 1D range. Invalidation sits under the swing
 * that built the structure (minus half an ATR); targets are R-multiples and the next 1D liquidity.
 */
export function tradePlan(type, d1, h4) {
  if (!['BUY_SETUP', 'ACCUMULATE'].includes(type) || !d1) return null;
  const price = h4?.close ?? d1.close;
  if (!isNum(price) || price <= 0) return null;
  const atr4 = h4?.atr14 ?? (isNum(d1.atrPct14) ? (d1.atrPct14 / 100) * price / 3 : price * 0.02);

  let entryLow;
  let entryHigh;
  let basis;
  let invalidation;
  if (type === 'BUY_SETUP') {
    const zone = h4?.orderBlocks?.[0] ?? h4?.fvgs?.[0] ?? null;
    if (zone) {
      entryHigh = Math.min(price, zone.top);
      entryLow = zone.bottom;
      basis = h4.orderBlocks?.[0] ? 'Order block bullish 4H (nemitigat)' : 'Fair value gap bullish 4H';
    } else {
      entryHigh = price;
      entryLow = Math.max(price - atr4 * 1.2, d1.ema20 ?? 0);
      basis = 'Retest EMA20 / ATR 4H (fără zonă SMC validă)';
    }
    const swing = h4?.sweep?.low ?? h4?.swingLow ?? d1.low30;
    invalidation = Math.min(entryLow, swing ?? entryLow) - 0.5 * atr4;
  } else {
    const lo = d1.low30;
    const hi = d1.high30;
    if (!isNum(lo) || !isNum(hi) || hi <= lo) return null;
    entryLow = lo;
    entryHigh = lo + (hi - lo) * 0.33;
    if (entryHigh > price) entryHigh = price;
    basis = 'Treimea inferioară a range-ului 30z (acumulare graduală)';
    const atrD = isNum(d1.atrPct14) ? (d1.atrPct14 / 100) * price : (hi - lo) * 0.15;
    invalidation = lo - atrD;
  }
  if (!(entryLow > 0) || !(entryHigh >= entryLow) || !(invalidation > 0) || invalidation >= entryLow) return null;

  const entryMid = (entryLow + entryHigh) / 2;
  const risk = entryMid - invalidation;
  const t1 = entryMid + 2 * risk;
  const t2 = entryMid + 4 * risk;
  const liquidity = Math.max(d1.high30 ?? 0, h4?.swingHigh ?? 0);
  const targets = [
    { label: 'T1 (2R)', price: t1 },
    { label: 'T2 (4R)', price: t2 },
  ];
  if (liquidity > t2 * 1.05) targets.push({ label: 'T3 (lichiditate 1D)', price: liquidity });
  return {
    timeframe: type === 'BUY_SETUP' ? '4H' : '1D',
    basis,
    entryLow: sig(entryLow),
    entryHigh: sig(entryHigh),
    invalidation: sig(invalidation),
    riskPct: round((risk / entryMid) * 100, 1),
    targets: targets.map((t) => ({ ...t, price: sig(t.price), pct: round((t.price / entryMid - 1) * 100, 0) })),
    rr: round((t2 - entryMid) / risk, 1),
    note: 'Plan de cercetare, nu ordin. Confirmă pe 1H/4H (CHoCH + retest) și respectă mărimea poziției indicată de gradul de risc.',
  };
}

const sig = (x) => (isNum(x) ? Number.parseFloat(x.toPrecision(6)) : null);
