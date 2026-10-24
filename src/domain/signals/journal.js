/**
 * Signal journal & track record (CRI v0.9.4 replay validation, run forward in time):
 * every BUY_SETUP / ACCUMULATE is recorded point-in-time with its price, then followed on
 * every run. Outcomes at 7/14/30 days are scored only after the horizon has fully elapsed,
 * and hit-rates are reported with Wilson 95% intervals — demonstrated, not claimed, performance.
 */
import { isNum, mean, median, round, wilson } from '../shared/math.js';
import { DAY_MS, toMs } from '../shared/time.js';

const TRACKED = ['BUY_SETUP', 'ACCUMULATE'];

/**
 * @param {{entries:any[]}} journal  previous journal (state)
 * @param {{key:string, symbol:string, price:number|null, signal:{type:string}, cri:number|null, analog:any, stage:string}[]} candidates
 * @param {number} nowMs
 * @param {{horizonsDays:number[], hitThresholdPct:number, cooldownDays:number, retentionDays?:number}} cfg
 * @param {Map<string, number>} priceByKey  latest price for every asset in the universe (not only candidates)
 */
export function updateJournal(journal, candidates, nowMs, cfg, priceByKey) {
  const entries = (journal?.entries ?? []).map((e) => ({ ...e, outcomes: { ...e.outcomes } }));
  const maxH = Math.max(...cfg.horizonsDays);

  // 1) Mark-to-market every open entry with the latest observed price (point-in-time).
  for (const e of entries) {
    const p = priceByKey.get(e.key);
    if (!isNum(p) || !isNum(e.entryPrice) || e.entryPrice <= 0) continue;
    const ageD = (nowMs - toMs(e.at)) / DAY_MS;
    if (ageD <= maxH + 1) {
      e.maxPrice = Math.max(e.maxPrice ?? e.entryPrice, p);
      e.minPrice = Math.min(e.minPrice ?? e.entryPrice, p);
    }
    e.lastPrice = p;
    e.lastAt = new Date(nowMs).toISOString();
    for (const h of cfg.horizonsDays) {
      const k = `d${h}`;
      if (e.outcomes[k] || ageD < h) continue;
      // first observation after the horizon: freeze the outcome for that horizon
      const ret = (p / e.entryPrice - 1) * 100;
      const mfe = ((e.maxPrice ?? p) / e.entryPrice - 1) * 100;
      const mae = ((e.minPrice ?? p) / e.entryPrice - 1) * 100;
      e.outcomes[k] = { returnPct: round(ret, 1), mfePct: round(mfe, 1), maePct: round(mae, 1), hit: mfe >= cfg.hitThresholdPct, at: e.lastAt };
    }
    e.status = cfg.horizonsDays.every((h) => e.outcomes[`d${h}`]) ? 'CLOSED' : 'OPEN';
  }

  // 2) Record new signals (one open entry per asset+type, cooldown after the previous one).
  for (const c of candidates) {
    if (!TRACKED.includes(c.signal?.type) || !isNum(c.price)) continue;
    const prev = entries.filter((e) => e.key === c.key && e.type === c.signal.type).sort((a, b) => toMs(b.at) - toMs(a.at))[0];
    if (prev && (nowMs - toMs(prev.at)) / DAY_MS < cfg.cooldownDays) continue;
    entries.push({
      id: `${c.key}:${c.signal.type}:${new Date(nowMs).toISOString()}`,
      key: c.key,
      symbol: c.symbol,
      type: c.signal.type,
      at: new Date(nowMs).toISOString(),
      entryPrice: c.price,
      maxPrice: c.price,
      minPrice: c.price,
      lastPrice: c.price,
      cri: c.cri,
      analog: c.analog?.ref ?? null,
      analogSimilarity: c.analog?.similarity ?? null,
      stage: c.stage,
      outcomes: {},
      status: 'OPEN',
    });
  }

  const retention = (cfg.retentionDays ?? 180) * DAY_MS;
  const kept = entries.filter((e) => nowMs - toMs(e.at) <= retention);
  return { entries: kept, summary: summarize(kept, cfg) };
}

export function summarize(entries, cfg) {
  const byType = {};
  for (const type of TRACKED) {
    const rows = entries.filter((e) => e.type === type);
    byType[type] = {
      total: rows.length,
      open: rows.filter((e) => e.status === 'OPEN').length,
      horizons: cfg.horizonsDays.map((h) => {
        const done = rows.map((e) => e.outcomes[`d${h}`]).filter(Boolean);
        const hits = done.filter((o) => o.hit).length;
        const w = wilson(hits, done.length);
        return {
          days: h,
          n: done.length,
          hits,
          hitRate: isNum(w.p) ? round(w.p * 100, 1) : null,
          ciLow: isNum(w.low) ? round(w.low * 100, 1) : null,
          ciHigh: isNum(w.high) ? round(w.high * 100, 1) : null,
          meanReturnPct: round(mean(done.map((o) => o.returnPct)), 1),
          medianReturnPct: round(median(done.map((o) => o.returnPct)), 1),
          meanMfePct: round(mean(done.map((o) => o.mfePct)), 1),
          meanMaePct: round(mean(done.map((o) => o.maePct)), 1),
        };
      }),
    };
  }
  return { hitThresholdPct: cfg.hitThresholdPct, byType, sampleWarning: entries.length < 20 ? 'Eșantion mic: intervalele de încredere sunt largi; nu trage concluzii încă.' : null };
}
