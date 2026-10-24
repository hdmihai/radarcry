/**
 * DEMO market simulator — deterministic, offline, clearly labelled synthetic data.
 * Lets the whole pipeline (and the dashboard) run with no network and no keys:
 * `npm run demo`. Project names are fictional except the market anchors (BTC, ETH, ...)
 * and the three references (LAB, BTW, AGT), whose paths follow the documented shape of
 * their real runs. Nothing here is market data — the snapshot is marked mode=fixture.
 */
const DAY = 86_400_000;
const H4 = 4 * 3_600_000;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const gauss = (rnd) => {
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const SYL = ['zen', 'tor', 'qua', 'lix', 'mor', 'vex', 'nar', 'kai', 'sol', 'ryn', 'tha', 'lum', 'dra', 'pyx', 'ori', 'cel', 'nox', 'ves', 'zar', 'hel', 'tri', 'quo', 'mir', 'sab', 'fen', 'gal', 'ion', 'jun', 'kor', 'vyn'];
const SUFFIX = ['', ' Protocol', ' AI', ' Network', ' Labs', ' Finance', ' Chain', '', ' DAO', ''];
const CATEGORIES = ['Artificial Intelligence (AI)', 'AI Agents', 'BNB Chain Ecosystem', 'Real World Assets (RWA)', 'DePIN', 'Gaming (GameFi)', 'Meme', 'Layer 1 (L1)', 'Layer 2 (L2)', 'Decentralized Finance (DeFi)', 'BTCFi', 'Perpetuals', 'Infrastructure', 'Solana Ecosystem', 'Data Availability'];

const ANCHORS = [
  ['bitcoin', 'BTC', 'Bitcoin', 2.1e12, 'native'], ['ethereum', 'ETH', 'Ethereum', 5.2e11, 'native'], ['tether', 'USDT', 'Tether', 1.9e11, 'ethereum', 'stablecoin'],
  ['binancecoin', 'BNB', 'BNB', 1.6e11, 'native'], ['solana', 'SOL', 'Solana', 1.1e11, 'native'], ['ripple', 'XRP', 'XRP', 1.4e11, 'native'],
  ['usd-coin', 'USDC', 'USDC', 8.1e10, 'ethereum', 'stablecoin'], ['dogecoin', 'DOGE', 'Dogecoin', 3.4e10, 'native'], ['tron', 'TRX', 'TRON', 2.9e10, 'native'],
  ['cardano', 'ADA', 'Cardano', 2.6e10, 'native'], ['wrapped-bitcoin', 'WBTC', 'Wrapped Bitcoin', 1.3e10, 'ethereum', 'wrapped-tokens'], ['staked-ether', 'STETH', 'Lido Staked Ether', 3.3e10, 'ethereum', 'liquid-staking-derivatives'],
  ['hyperliquid', 'HYPE', 'Hyperliquid', 1.5e10, 'native'], ['chainlink', 'LINK', 'Chainlink', 1.2e10, 'ethereum'], ['ethena-usde', 'USDE', 'Ethena USDe', 1.1e10, 'ethereum', 'stablecoin'],
  ['first-digital-usd', 'FDUSD', 'First Digital USD', 1.6e9, 'bsc', 'stablecoin'],
];

/** Archetypes drive the price path; the scanner never sees the archetype, only the data. */
function pathFor(arch, rnd, nDays, endIdx, opts = {}) {
  const c = new Array(nDays);
  const v = new Array(nDays);
  let lp = Math.log(opts.p0 ?? 1);
  const sched = opts.sched ?? {};
  for (let i = 0; i < nDays; i += 1) {
    const rel = i - endIdx; // days relative to "now" (0 = last day)
    let drift = 0;
    let vol = 0.045;
    let turn = opts.turnover ?? 0.08;
    switch (arch) {
      case 'SETUP': {
        // decline → base → building → pre-expansion → (expansion at sched.expand) → post
        const { declineEnd, baseEnd, buildEnd, expand, expandDays = 18, expandGain = 6 } = sched;
        if (rel < declineEnd) { drift = -0.012; vol = 0.06; turn *= 0.9; }
        else if (rel < baseEnd) { drift = 0.0005; vol = 0.035; turn *= 0.6; }
        else if (rel < buildEnd) { drift = 0.006; vol = 0.03; turn *= 0.9 + (rel - baseEnd) * 0.02; }
        else if (rel < expand) { drift = 0.003; vol = 0.018; turn *= 1.8 + (rel - buildEnd) * 0.08; }
        else if (rel < expand + expandDays) { drift = Math.log(expandGain) / expandDays; vol = 0.09; turn *= 4.5; }
        else { drift = -0.02; vol = 0.08; turn *= 1.6; }
        break;
      }
      case 'ACCUM': {
        const { declineEnd } = sched;
        if (rel < declineEnd) { drift = -0.008; vol = 0.05; } else { drift = 0.0018; vol = 0.028; turn *= 1.1; }
        break;
      }
      case 'HYPED': {
        if (rel > -9) { drift = 0.11; vol = 0.11; turn *= 6; } else { drift = -0.002; vol = 0.05; }
        break;
      }
      case 'DUMPED': {
        if (rel > -60 && rel <= -42) { drift = 0.12; vol = 0.1; turn *= 4; } else if (rel > -42) { drift = -0.03; vol = 0.07; turn *= 1.3; } else { drift = 0; vol = 0.04; }
        break;
      }
      case 'DECLINER': drift = -0.006; vol = 0.05; break;
      case 'LARGE': drift = 0.0006; vol = 0.028; turn = opts.turnover ?? 0.04; break;
      case 'REF_LAB': {
        // TGE ≈ -365d at $0.30 → ~$0.10 by -200d → base → pump from ≈ -197d (+1.500% in 30d) → ATH $28 at ≈ -120d → -77% → drift
        const pts = [[-400, 0.3], [-260, 0.11], [-200, 0.095], [-197, 0.1], [-185, 0.7], [-182, 3.2], [-168, 5.8], [-140, 9], [-121, 27.5], [-110, 6.4], [-60, 7.5], [-20, 9.2], [0, 8.1]];
        return interp(pts, nDays, endIdx, rnd, opts, [-197, -165, 5.5]);
      }
      case 'REF_BTW': {
        const pts = [[-400, 0.08], [-300, 0.06], [-120, 0.05], [-75, 0.052], [-72, 0.09], [-50, 0.6], [-30, 1.3], [-3, 2.75], [-2, 2.45], [0, 1.9]];
        return interp(pts, nDays, endIdx, rnd, opts, [-72, -3, 4.5]);
      }
      case 'REF_AGT': {
        const pts = [[-400, 0.05], [-320, 0.03], [-150, 0.016], [-75, 0.0144], [-70, 0.0145], [-58, 0.03], [-40, 0.028], [-15, 0.04], [-4, 0.062], [0, 0.058]];
        return interp(pts, nDays, endIdx, rnd, opts, [-70, -4, 3.5]);
      }
      default: drift = 0; vol = 0.045;
    }
    lp += drift + vol * gauss(rnd);
    c[i] = Math.exp(lp);
    v[i] = Math.max(0.002, turn * Math.exp(0.35 * gauss(rnd)));
  }
  return { c, turnover: v };
}

function interp(pts, nDays, endIdx, rnd, opts, [hotFrom, hotTo, hotTurnover]) {
  const c = new Array(nDays);
  const v = new Array(nDays);
  for (let i = 0; i < nDays; i += 1) {
    const rel = i - endIdx;
    let k = 0;
    while (k < pts.length - 2 && rel > pts[k + 1][0]) k += 1;
    const [x0, y0] = pts[k];
    const [x1, y1] = pts[k + 1];
    const f = Math.min(1, Math.max(0, (rel - x0) / (x1 - x0 || 1)));
    const base = Math.exp(Math.log(y0) + (Math.log(y1) - Math.log(y0)) * f);
    c[i] = base * Math.exp(0.03 * gauss(rnd));
    v[i] = (rel >= hotFrom && rel <= hotTo ? hotTurnover : opts.turnover ?? 0.1) * Math.exp(0.3 * gauss(rnd));
  }
  return { c, turnover: v };
}

function makeName(rnd, used) {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const n = 2 + Math.floor(rnd() * 2);
    let s = '';
    for (let i = 0; i < n; i += 1) s += SYL[Math.floor(rnd() * SYL.length)];
    const name = s[0].toUpperCase() + s.slice(1) + SUFFIX[Math.floor(rnd() * SUFFIX.length)];
    const letters = s.toUpperCase();
    const len = 3 + Math.floor(rnd() * 2);
    let sym = letters[0];
    for (let k = 1; k < len; k += 1) sym += letters[1 + Math.floor(rnd() * (letters.length - 1))];
    if (!used.has(sym)) { used.add(sym); return { name, symbol: sym }; }
  }
  throw new Error('demo: nu pot genera un simbol unic');
}

const hex = (rnd, n = 40) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');

/**
 * Build the simulated universe once. `endMs` is the demo "now" (the last simulated day).
 */
export function createDemoMarket({ endMs, days = 430, size = 1260, seed = 20261017 } = {}) {
  const rnd = mulberry32(seed);
  const startMs = endMs - (days - 1) * DAY;
  const endIdx = days - 1;
  const used = new Set(ANCHORS.map((a) => a[1]).concat(['LAB', 'BTW', 'AGT']));
  const assets = [];

  for (const [id, symbol, name, mcap, chain, tag] of ANCHORS) {
    const r = mulberry32(hashSeed(id));
    const circ = mcap / (tag === 'stablecoin' ? 1 : 100 * (0.5 + r()));
    const p = tag === 'stablecoin' ? { c: new Array(days).fill(1).map(() => 1 + 0.0006 * gauss(r)), turnover: new Array(days).fill(0.05) } : pathFor('LARGE', r, days, endIdx, { p0: 1, turnover: 0.04 });
    const scale = tag === 'stablecoin' ? 1 : mcap / circ / p.c[endIdx];
    assets.push(baseAsset({ id, symbol, name, chain: chain === 'native' ? null : chain, tags: tag ? [tag] : [], circ, total: circ * 1.02, max: null, path: { c: p.c.map((x) => x * scale), turnover: p.turnover }, listedAt: startMs - 2000 * DAY, rnd: r, archetype: 'LARGE' }));
  }

  // References (documented shapes).
  const refs = [
    { id: 'lab-demo', symbol: 'LAB', name: 'LAB', arch: 'REF_LAB', circ: 230e6, total: 1e9, listed: -365 },
    { id: 'bitway', symbol: 'BTW', name: 'Bitway', arch: 'REF_BTW', circ: 1.5e9, total: 10e9, listed: -420 },
    { id: 'alaya-ai', symbol: 'AGT', name: 'Alaya AI', arch: 'REF_AGT', circ: 3.26e9, total: 5e9, listed: -515 },
  ];
  for (const ref of refs) {
    const r = mulberry32(hashSeed(ref.id));
    const p = pathFor(ref.arch, r, days, endIdx, { turnover: 0.12 });
    const a = baseAsset({ id: ref.id, symbol: ref.symbol, name: ref.name, chain: 'bsc', tags: ['bnb-chain-ecosystem'], circ: ref.circ, total: ref.total, max: ref.total, path: p, listedAt: endMs + ref.listed * DAY, rnd: r, archetype: ref.arch });
    a.venues = { mexc: true, perps: ['mexc', 'gate', 'bitget', 'okx'], upbit: false, bithumb: ref.symbol === 'AGT', alpha: true, alphaCex: true };
    a.top10 = ref.symbol === 'BTW' ? 97 : 84;
    assets.push(a);
  }

  // Synthetic projects.
  const n = size - assets.length;
  for (let i = 0; i < n; i += 1) {
    const { name, symbol } = makeName(rnd, used);
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i}`;
    const r = mulberry32(hashSeed(id));
    const targetMcap = 1.5e12 * (i + 18) ** -1.62 * Math.exp(0.35 * gauss(r));
    const roll = r();
    let arch = 'NOISE';
    let sched;
    const smallish = targetMcap < 1.6e8 && targetMcap > 7e6;
    if (smallish && roll < 0.026) { arch = 'SETUP'; sched = { declineEnd: -160 + Math.floor(r() * 30), baseEnd: -70 + Math.floor(r() * 15), buildEnd: -24 + Math.floor(r() * 8), expand: 2 + Math.floor(r() * 8), expandGain: 4 + r() * 8 }; }
    else if (smallish && roll < 0.036) { arch = 'SETUP'; sched = { declineEnd: -190, baseEnd: -95, buildEnd: -48, expand: -26 + Math.floor(r() * 10), expandDays: 14, expandGain: 3 + r() * 4 }; }
    else if (smallish && roll < 0.07) { arch = 'ACCUM'; sched = { declineEnd: -90 - Math.floor(r() * 60) }; }
    else if (roll < 0.085) arch = 'HYPED';
    else if (roll < 0.11) arch = 'DUMPED';
    else if (roll < 0.3) arch = 'DECLINER';
    const p = pathFor(arch, r, days, endIdx, { turnover: 0.03 + r() * 0.12, sched });
    /*
     * Two flavours of pre-expansion exist in the real market and the fixture carries both, because
     * they score very differently and the dashboard must show that difference honestly:
     *  · the LAB/BTW/AGT profile — low float, concentrated, fast: high opportunity but high risk;
     *  · the "clean small cap" — real float, distributed holders, TVL and development: the only
     *    shape that can clear `risc < 60` and therefore become an Early Research Candidate.
     */
    const cleanSetup = arch === 'SETUP' && r() < 0.42;
    const floatRatio = arch === 'SETUP' ? (cleanSetup ? 0.55 + r() * 0.4 : 0.06 + r() * 0.2) : 0.2 + r() * 0.8;
    const total = 1e8 * 10 ** (r() * 2.5);
    const circ = total * floatRatio;
    const scale = targetMcap / circ / p.c[endIdx];
    const chainRoll = r();
    const chain = arch === 'SETUP' ? (chainRoll < 0.72 ? 'bsc' : chainRoll < 0.86 ? 'solana' : 'base') : chainRoll < 0.3 ? 'bsc' : chainRoll < 0.55 ? 'ethereum' : chainRoll < 0.72 ? 'solana' : chainRoll < 0.8 ? 'base' : chainRoll < 0.86 ? 'arbitrum' : null;
    const listedDaysAgo = arch === 'SETUP' ? 150 + Math.floor(r() * 250) : 60 + Math.floor(r() * 1800);
    const a = baseAsset({ id, symbol, name, chain, tags: [], circ, total, max: r() < 0.5 ? total : null, path: { c: p.c.map((x) => x * scale), turnover: p.turnover }, listedAt: endMs - listedDaysAgo * DAY, rnd: r, archetype: arch });
    const HOT = ['Artificial Intelligence (AI)', 'AI Agents', 'DePIN', 'Real World Assets (RWA)'];
    a.categories = [cleanSetup ? HOT[Math.floor(r() * HOT.length)] : CATEGORIES[Math.floor(r() * CATEGORIES.length)], ...(chain === 'bsc' ? ['BNB Chain Ecosystem'] : [])];
    a.cleanSetup = cleanSetup;
    const isSetup = arch === 'SETUP';
    a.venues = {
      mexc: isSetup || r() < 0.68,
      perps: isSetup ? ['mexc', 'gate', 'bitget'].slice(0, 1 + Math.floor(r() * 3)) : r() < 0.33 ? ['mexc', 'gate', 'bitget', 'okx'].filter(() => r() < 0.55) : [],
      upbit: r() < 0.06,
      bithumb: r() < 0.09,
      alpha: chain === 'bsc' && (isSetup ? r() < 0.8 : r() < 0.25),
      alphaCex: false,
    };
    a.perpListedDaysAgo = isSetup && r() < 0.5 ? 2 + Math.floor(r() * 25) : null;
    a.top10 = isSetup ? (cleanSetup ? 18 + r() * 16 : 70 + r() * 28) : 20 + r() * 60;
    a.honeypot = arch === 'NOISE' && r() < 0.01;
    a.sellTax = a.honeypot ? 0.99 : r() < 0.04 ? 0.05 + r() * 0.1 : 0;
    a.holders0 = Math.round(10 ** ((cleanSetup ? 4.1 : 3) + r() * 2.2));
    a.tvl = cleanSetup ? targetMcap * (0.4 + r() * 1.6) : r() < 0.08 ? targetMcap * (0.1 + r() * 2) : null;
    a.devCommits = cleanSetup ? 25 + Math.floor(r() * 70) : r() < 0.5 ? Math.floor(r() * 80) : null;
    a.watch0 = Math.round(10 ** (3 + r() * 2));
    assets.push(a);
  }
  return { assets, startMs, endMs, days };
}

function baseAsset({ id, symbol, name, chain, tags, circ, total, max, path, listedAt, rnd, archetype }) {
  return {
    id, symbol, name, chain, tags, circ, total, max, path, listedAt, archetype,
    address: chain === 'solana' ? hex(rnd, 32) + 'pump' : chain ? `0x${hex(rnd)}` : null,
    venues: { mexc: archetype === 'LARGE', perps: archetype === 'LARGE' ? ['mexc', 'gate', 'bitget', 'okx'] : [], upbit: archetype === 'LARGE', bithumb: archetype === 'LARGE', alpha: false, alphaCex: false },
    categories: [],
    top10: 30,
    honeypot: false,
    sellTax: 0,
    holders0: 50_000,
    tvl: null,
    devCommits: null,
    watch0: 100_000,
  };
}

/** Market state of one asset at time t (price, cap, volume, changes, ATH). */
export function stateAt(m, a, tMs) {
  const idx = Math.max(0, Math.min(m.days - 1, Math.floor((tMs - m.startMs) / DAY)));
  if (tMs < a.listedAt) return null;
  const firstIdx = Math.max(0, Math.floor((a.listedAt - m.startMs) / DAY));
  const p = a.path.c[idx];
  const back = (d) => a.path.c[Math.max(firstIdx, idx - d)];
  const ch = (d) => (idx - d >= firstIdx ? (p / back(d) - 1) * 100 : null);
  let ath = 0;
  for (let i = firstIdx; i <= idx; i += 1) ath = Math.max(ath, a.path.c[i]);
  const circ = a.circ;
  const mcap = p * circ;
  return {
    price: p,
    marketCap: mcap,
    volume24h: mcap * a.path.turnover[idx],
    change: { h1: (a.path.c[idx] / a.path.c[Math.max(0, idx - 1)] - 1) * 100 / 24, h24: ch(1), d7: ch(7), d14: ch(14), d30: ch(30), d200: ch(200), y1: ch(365) },
    ath,
    athChangePct: (p / ath - 1) * 100,
    idx,
  };
}

/** 1D or 4H candles up to time t (4H synthesised from the daily path). */
export function candlesAt(m, a, tMs, interval, limit) {
  const st = stateAt(m, a, tMs);
  if (!st) return [];
  const firstIdx = Math.max(0, Math.floor((a.listedAt - m.startMs) / DAY));
  const out = [];
  if (interval === '1d') {
    for (let i = Math.max(firstIdx + 1, st.idx - limit + 1); i <= st.idx; i += 1) {
      const o = a.path.c[i - 1];
      const c = a.path.c[i];
      const r = mulberry32(hashSeed(`${a.id}:${i}`));
      const h = Math.max(o, c) * (1 + 0.025 * r());
      const l = Math.min(o, c) * (1 - 0.025 * r());
      out.push({ t: m.startMs + (i - 1) * DAY, o, h, l, c, v: c * a.circ * a.path.turnover[i] * 0.35, closed: i < st.idx });
    }
    return out;
  }
  const bars = [];
  for (let i = Math.max(firstIdx + 1, st.idx - Math.ceil(limit / 6) - 1); i <= st.idx; i += 1) {
    const o = a.path.c[i - 1];
    const c = a.path.c[i];
    const r = mulberry32(hashSeed(`${a.id}:4h:${i}`));
    let prev = o;
    for (let k = 0; k < 6; k += 1) {
      const f = (k + 1) / 6;
      const target = Math.exp(Math.log(o) + (Math.log(c) - Math.log(o)) * f) * (1 + 0.012 * gauss(r));
      const close = k === 5 ? c : target;
      const h = Math.max(prev, close) * (1 + 0.01 * r());
      const l = Math.min(prev, close) * (1 - 0.01 * r());
      const openT = m.startMs + (i - 1) * DAY + k * H4;
      if (openT > tMs) break;
      bars.push({ t: openT, o: prev, h, l, c: close, v: close * a.circ * a.path.turnover[i] * 0.06, closed: openT + H4 <= tMs });
      prev = close;
    }
  }
  return bars.slice(-limit);
}
