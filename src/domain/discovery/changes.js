/**
 * "CE S-A SCHIMBAT" — the literal engine behind the project's central question:
 *
 *   „Arată-mi proiectele mici unde se schimbă simultan mai multe lucruri importante,
 *    înainte ca mișcarea să devină evidentă."
 *
 * Three ideas are encoded here and nowhere else:
 *
 *  1. IMPORTANT — only a closed list of factors counts as a change, each with a direction that
 *     matters and a threshold expressed against the asset's own baseline (robust z or % move), not
 *     against a market-wide constant. A token that always has erratic volume does not earn a volume
 *     change for the same jump that would be remarkable on a quiet one.
 *
 *  2. SIMULTANEOUSLY — changes are counted inside a window (default 7 days) and across *distinct
 *     families* (flow, holders, liquidity, derivatives, fundamentals, attention, listing). Five
 *     signals from the same family are one thing happening, not five; the confluence score rewards
 *     breadth across families, which is what actually precedes an expansion.
 *
 *  3. BEFORE IT IS OBVIOUS — the obviousness penalty. Price already up a lot, volume already at a
 *     yearly high, the token already trending everywhere: all of that *lowers* the earliness of the
 *     finding even while raising its momentum. This is the LAB case from the attachment: +400 % is
 *     momentum 98 and early discovery 35.
 */
import { clamp, isNum, round } from '../shared/math.js';
import { ACCESS_CATALYSTS } from '../catalysts/catalysts.js';

/** Families of change. Breadth across families is what the confluence score measures. */
export const FAMILIES = {
  FLOW: 'FLOW',
  HOLDERS: 'HOLDERS',
  LIQUIDITY: 'LIQUIDITY',
  DERIVATIVES: 'DERIVATIVES',
  FUNDAMENTALS: 'FUNDAMENTALS',
  ATTENTION: 'ATTENTION',
  LISTING: 'LISTING',
  STRUCTURE: 'STRUCTURE',
};

export const FAMILY_LABEL_RO = {
  FLOW: 'fluxuri (volum, rotație)',
  HOLDERS: 'deținători și concentrare',
  LIQUIDITY: 'lichiditate',
  DERIVATIVES: 'derivate (OI, funding)',
  FUNDAMENTALS: 'fundamente (TVL, venituri, dezvoltare)',
  ATTENTION: 'atenție și narațiune',
  LISTING: 'listări și acces',
  STRUCTURE: 'structură de preț',
};

/**
 * The closed list of what counts as an important change. Each detector reads the baseline
 * comparison (`cmp`), the live facts (`a`) and returns null or a change object.
 *
 * `weight` is the contribution to the confluence score; `direction` is what we consider the
 * constructive side. Thresholds come from the technical solution's small-cap section.
 */
const DETECTORS = [
  {
    key: 'VOLUME_EXPANSION',
    family: FAMILIES.FLOW,
    weight: 1,
    label: 'Volum în expansiune față de propria normă',
    test: ({ cmp }) => {
      const v = cmp.volume24h;
      if (!isNum(v.z) || v.n < 4) return null;
      if (v.z < 2) return null;
      return { magnitude: v.z, detail: `volum la z=${round(v.z, 1)} față de mediana proprie (${fmtPct(v.changePct)})` };
    },
  },
  {
    key: 'TURNOVER_JUMP',
    family: FAMILIES.FLOW,
    weight: 0.6,
    label: 'Rotația capitalizării a sărit',
    test: ({ cmp, a }) => {
      const t = cmp.turnover;
      if (!isNum(t.z) || t.n < 4 || t.z < 2) return null;
      if (!isNum(a.derived?.turnover) || a.derived.turnover < 0.02) return null;
      return { magnitude: t.z, detail: `rotație ${round(a.derived.turnover * 100, 1)}%/zi, z=${round(t.z, 1)}` };
    },
  },
  {
    key: 'LIQUIDITY_GROWTH',
    family: FAMILIES.LIQUIDITY,
    weight: 1,
    label: 'Lichiditatea DEX crește',
    test: ({ cmp }) => {
      const l = cmp.liquidityUsd;
      if (!isNum(l.changePct) || l.n < 3) return null;
      if (l.changePct < 25) return null;
      return { magnitude: l.changePct / 25, detail: `lichiditate ${fmtPct(l.changePct)} față de mediana de 30 zile` };
    },
  },
  {
    key: 'HOLDER_GROWTH',
    family: FAMILIES.HOLDERS,
    weight: 1,
    label: 'Numărul de deținători crește',
    test: ({ cmp }) => {
      const h = cmp.holders;
      if (!isNum(h.changePct) || h.n < 3) return null;
      if (h.changePct < 8) return null;
      return { magnitude: h.changePct / 8, detail: `deținători ${fmtPct(h.changePct)} față de mediana de 30 zile` };
    },
  },
  {
    key: 'CONCENTRATION_DROP',
    family: FAMILIES.HOLDERS,
    weight: 0.8,
    label: 'Concentrarea în top 10 scade (distribuție)',
    test: ({ cmp }) => {
      const c = cmp.top10Pct;
      if (!isNum(c.value) || !isNum(c.median) || c.n < 3) return null;
      const delta = c.value - c.median;
      if (delta > -2) return null;
      return { magnitude: Math.abs(delta) / 2, detail: `top 10 deține ${round(c.value, 1)}%, cu ${round(Math.abs(delta), 1)} puncte mai puțin decât mediana` };
    },
  },
  {
    key: 'WHALE_ACCUMULATION',
    family: FAMILIES.HOLDERS,
    weight: 1.2,
    label: 'Portofelele mari acumulează',
    test: ({ a }) => {
      const f = a.onchain?.flows;
      if (!f || !['ACCUMULATION', 'ACCUMULATING'].includes(f.verdict)) return null;
      const w = f.accumulating ?? 0;
      return { magnitude: f.verdict === 'ACCUMULATION' ? 2 : 1, detail: `${w} portofele mari în acumulare, fără depozite nete la CEX` };
    },
  },
  {
    key: 'CEX_WITHDRAWALS',
    family: FAMILIES.FLOW,
    weight: 1,
    label: 'Retrageri nete de pe burse centralizate',
    test: ({ cmp, a }) => {
      const c = cmp.cexBalancePct;
      if (!isNum(c.value) || !isNum(c.median) || c.n < 3) return null;
      const delta = c.value - c.median;
      if (delta > -1) return null;
      void a;
      return { magnitude: Math.abs(delta), detail: `soldul pe CEX a scăzut cu ${round(Math.abs(delta), 2)} puncte din supply` };
    },
  },
  {
    key: 'OI_BUILDUP',
    family: FAMILIES.DERIVATIVES,
    weight: 0.8,
    label: 'Open interest în creștere',
    test: ({ cmp, a }) => {
      const o = cmp.oiUsd;
      if (!isNum(o.changePct) || o.n < 3 || o.changePct < 30) return null;
      const funding = a.derivatives?.fundingPct8h;
      if (isNum(funding) && funding >= 0.05) return null; // already a crowded, late trade
      return { magnitude: o.changePct / 30, detail: `open interest ${fmtPct(o.changePct)}, funding ${isNum(funding) ? `${round(funding, 4)}%/8h` : 'necunoscut'}` };
    },
  },
  {
    key: 'FUNDING_FLIP',
    family: FAMILIES.DERIVATIVES,
    weight: 0.6,
    label: 'Funding negativ — short-uri aglomerate',
    test: ({ a }) => {
      const f = a.derivatives?.fundingPct8h;
      if (!isNum(f) || f > -0.01) return null;
      return { magnitude: Math.abs(f) / 0.01, detail: `funding ${round(f, 4)}%/8h — short-urile plătesc` };
    },
  },
  {
    key: 'TVL_GROWTH',
    family: FAMILIES.FUNDAMENTALS,
    weight: 1,
    label: 'TVL sau venituri în creștere',
    test: ({ cmp, a }) => {
      const t = cmp.tvl;
      const byBaseline = isNum(t.changePct) && t.n >= 3 && t.changePct >= 15;
      const byLlama = isNum(a.fundamentals?.tvlChange7d) && a.fundamentals.tvlChange7d >= 15;
      if (!byBaseline && !byLlama) return null;
      const pct = byBaseline ? t.changePct : a.fundamentals.tvlChange7d;
      return { magnitude: pct / 15, detail: `TVL ${fmtPct(pct)} pe 7 zile` };
    },
  },
  {
    key: 'DEV_ACTIVITY',
    family: FAMILIES.FUNDAMENTALS,
    weight: 0.6,
    label: 'Activitate de dezvoltare în creștere',
    test: ({ cmp, a }) => {
      const d = cmp.devCommits30d;
      const commits = a.social?.devCommits30d;
      if (!isNum(commits) || commits < 10) return null;
      if (!isNum(d.changePct) || d.n < 3 || d.changePct < 30) return null;
      return { magnitude: d.changePct / 30, detail: `${commits} commit-uri în 30 zile, ${fmtPct(d.changePct)} față de normă` };
    },
  },
  {
    key: 'NARRATIVE_MOMENTUM',
    family: FAMILIES.ATTENTION,
    kind: 'CONDITION', // the sector is hot — true for weeks, and true of every token in it
    weight: 0.6,
    label: 'Narațiunea sectorului se încălzește',
    test: ({ a }) => {
      const n = a.narrative;
      if (!n || !isNum(n.score) || n.score < 65) return null;
      return { magnitude: (n.score - 65) / 10, detail: `sectorul ${n.label ?? 'principal'} la ${round(n.score, 0)}/100` };
    },
  },
  {
    key: 'MENTIONS_PICKUP',
    family: FAMILIES.ATTENTION,
    weight: 0.5,
    label: 'Mențiuni în creștere, de la o bază joasă',
    test: ({ cmp }) => {
      const m = cmp.mentions7d;
      if (!isNum(m.z) || m.n < 4 || m.z < 2) return null;
      if (isNum(m.value) && m.value > 200) return null; // already loud = already obvious
      return { magnitude: m.z, detail: `mențiuni la z=${round(m.z, 1)}, de la o bază mică` };
    },
  },
  {
    key: 'NEW_VENUE',
    family: FAMILIES.LISTING,
    weight: 1.2,
    label: 'Acces nou: listare sau piață nouă',
    test: ({ a }) => {
      const c = (a.catalysts ?? []).filter((x) => x.fresh && ACCESS_CATALYSTS.includes(x.type));
      if (!c.length) return null;
      return { magnitude: c.length, detail: c.map((x) => x.label).join('; ') };
    },
  },
  {
    key: 'STRUCTURE_SHIFT',
    family: FAMILIES.STRUCTURE,
    weight: 0.8,
    label: 'Structura de preț s-a schimbat (CHoCH / BOS)',
    test: ({ a }) => {
      const ev = a.futures?.setup?.smc?.lastEvent;
      if (!ev || ev.dir !== 'UP' || ev.barsAgo > 18) return null;
      return { magnitude: ev.type === 'CHOCH' ? 2 : 1, detail: `${ev.type} în sus acum ${ev.barsAgo} bare de 4H` };
    },
  },
  {
    key: 'COMPRESSION',
    family: FAMILIES.STRUCTURE,
    weight: 0.6,
    label: 'Volatilitate comprimată — energie acumulată',
    test: ({ a }) => {
      const c = a.features?.daily?.compression;
      if (!isNum(c) || c > 0.65) return null;
      const vol = a.features?.daily?.volAccel;
      if (!isNum(vol) || vol < 1.2) return null;
      return { magnitude: (0.65 - c) / 0.15, detail: `compresie ${round(c, 2)} cu volum ${round(vol, 2)}× — interval strâns, flux în creștere` };
    },
  },
  {
    key: 'SUPPLY_RELIEF',
    family: FAMILIES.FUNDAMENTALS,
    kind: 'CONDITION', // most supply already circulating — a level, not a movement
    weight: 0.5,
    label: 'Presiunea de supply se relaxează',
    test: ({ a }) => {
      const s = a.risk?.supply;
      if (!s || !isNum(s.floatRatio)) return null;
      if (s.floatRatio < 0.6 || s.unlockWithin30d) return null;
      return { magnitude: 1, detail: `${Math.round(s.floatRatio * 100)}% din supply deja în circulație, fără deblocare mare în 30 de zile` };
    },
  },
];

const fmtPct = (x) => (isNum(x) ? `${x > 0 ? '+' : ''}${round(x, 1)}%` : 'necunoscut');

/**
 * Detectors that describe a standing condition rather than something that moved. They are real and
 * they matter — a hot sector, a float that is already mostly circulating — so they are reported as
 * context and they keep feeding their own factors of the pre-expansion score. But they are not
 * *changes*: counting them let a project in which nothing had moved reach "Stage 1 · early activity"
 * on the strength of its tokenomics alone, and let two real changes plus one condition pass for
 * "three things changing at once". Only events count toward the project's question.
 */
export const CONDITION_KEYS = new Set(DETECTORS.filter((d) => d.kind === 'CONDITION').map((d) => d.key));

/**
 * Confluence of a set of changes: a weighted count with diminishing returns inside a family (the
 * second signal of the same kind adds 40 %, not 100 %) and an 18 % bonus per additional family.
 * Breadth is rewarded because several *different* things moving together is what precedes an
 * expansion; five readings of one volume spike are still one thing happening.
 *
 * @param {{family:string, weight:number, magnitude:number}[]} changes
 */
export function confluenceOf(changes) {
  const byFamily = new Map();
  for (const c of changes ?? []) byFamily.set(c.family, [...(byFamily.get(c.family) ?? []), c]);
  let raw = 0;
  for (const list of byFamily.values()) {
    const sorted = [...list].sort((a, b) => b.weight * b.magnitude - a.weight * a.magnitude);
    sorted.forEach((c, i) => { raw += c.weight * Math.min(c.magnitude, 3) * (i === 0 ? 1 : 0.4); });
  }
  return round(raw * (1 + 0.18 * Math.max(0, byFamily.size - 1)), 2);
}

/**
 * Run every detector and build the confluence view.
 *
 * @param {{asset:any, cmp:Record<string, any>, windowDays?:number}} input
 * @returns {{changes:any[], families:string[], familyCount:number, count:number,
 *   confluence:number, simultaneous:boolean, obviousness:number, earliness:number, summary:string}}
 */
export function whatChanged({ asset, cmp, windowDays = 7 }) {
  const ctx = { a: asset, cmp: cmp ?? {} };
  const hits = [];
  for (const d of DETECTORS) {
    let hit = null;
    try {
      hit = d.test(ctx);
    } catch {
      hit = null;
    }
    if (!hit) continue;
    hits.push({
      key: d.key,
      family: d.family,
      familyLabel: FAMILY_LABEL_RO[d.family],
      label: d.label,
      weight: d.weight,
      magnitude: round(clamp(hit.magnitude ?? 1, 0, 6), 2),
      detail: hit.detail,
    });
  }

  const byWeight = (a, b) => b.weight * b.magnitude - a.weight * a.magnitude;
  const changes = hits.filter((c) => !CONDITION_KEYS.has(c.key)).sort(byWeight);
  const conditions = hits.filter((c) => CONDITION_KEYS.has(c.key)).sort(byWeight);
  const families = [...new Set(changes.map((c) => c.family))];
  const breadth = families.length;
  const confluence = confluenceOf(changes);

  const obvious = obviousness(asset);
  const earliness = clamp(Math.round(100 - obvious), 0, 100);

  const summary = changes.length
    ? `${changes.length} ${changes.length === 1 ? 'schimbare' : 'schimbări'} în ${breadth} ${breadth === 1 ? 'familie' : 'familii'} (fereastră ${windowDays}z): ${changes.slice(0, 3).map((c) => c.label.toLowerCase()).join('; ')}`
    : 'nicio schimbare importantă detectată peste propria normă';

  return {
    changes,
    conditions,
    families,
    familyCount: breadth,
    count: changes.length,
    confluence,
    // The user's question asks for *several* important things at once: at least 3 changes
    // spread over at least 2 distinct families.
    simultaneous: changes.length >= 3 && breadth >= 2,
    obviousness: round(obvious, 1),
    earliness,
    windowDays,
    summary,
  };
}

/**
 * OBVIOUSNESS — how much of the move has already happened in public.
 * This is the attachment's maturity penalty: a token already up 400 % is not an early finding, even
 * though its momentum is excellent. Returns 0..100, where 100 = fully obvious.
 */
export function obviousness(asset) {
  let o = 0;
  const m = asset.market ?? {};
  const d = asset.features?.daily ?? {};
  const ch30 = m.change?.d30;
  const ch7 = m.change?.d7;

  if (isNum(ch30)) {
    if (ch30 > 300) o += 45;
    else if (ch30 > 150) o += 34;
    else if (ch30 > 80) o += 24;
    else if (ch30 > 40) o += 14;
    else if (ch30 > 15) o += 6;
  }
  if (isNum(ch7)) {
    if (ch7 > 100) o += 20;
    else if (ch7 > 50) o += 14;
    else if (ch7 > 25) o += 8;
  }
  if (isNum(d.rangePos30) && d.rangePos30 > 0.92) o += 10;
  if (isNum(d.expansionGainPct) && d.expansionGainPct > 120) o += 8;
  if (asset.attention?.cgTrending === true) o += 10;
  if (isNum(asset.attention?.dexBoost) && asset.attention.dexBoost > 0) o += 5;
  if (asset.attention?.gtTrending === true) o += 5;
  if (isNum(d.volAccel) && d.volAccel > 6) o += 8;
  if (isNum(asset.derivatives?.fundingPct8h) && asset.derivatives.fundingPct8h >= 0.015) o += 8;
  if (isNum(m.athChangePct) && m.athChangePct > -15) o += 6; // near all-time high = fully discovered
  return clamp(o, 0, 100);
}
