/**
 * NARRATIVE ENGINE — which sector is being bid, and does this token belong to it?
 *
 * Narrative is the factor most dashboards assert and least often measure. Here it is measured from
 * data we already hold: CoinGecko's category list (market cap and 24h change per category) plus the
 * token's own tags, aggregated into a sector score with its coverage attached. A sector with two
 * members is reported as a sector with two members, not as a trend.
 */
import { clamp, isNum, mean, median, round } from '../shared/math.js';

/**
 * Canonical sectors, with the tag / category fragments that map onto them. Order matters: the first
 * match wins, so the more specific narratives are listed before the broad ones.
 */
export const SECTORS = [
  { key: 'AI', label: 'AI și agenți', match: [/\bai\b/, /artificial.intelligence/, /agent/, /machine.learning/, /deep.?in/, /\bllm\b/] },
  { key: 'DEPIN', label: 'DePIN și infrastructură fizică', match: [/depin/, /decentralized.physical/, /iot/, /wireless/, /compute.network/, /storage/] },
  { key: 'RWA', label: 'RWA și tokenizare', match: [/rwa/, /real.world.asset/, /tokeniz/, /treasur(y|ies).bill/] },
  { key: 'GAMING', label: 'Gaming și metavers', match: [/gaming/, /game.?fi/, /metaverse/, /play.to.earn/, /\bnft\b/] },
  { key: 'MEME', label: 'Meme', match: [/meme/, /dog.?(coin|wifhat)/, /frog/, /cat.coin/] },
  { key: 'DEFI', label: 'DeFi', match: [/defi/, /\bdex\b/, /lending/, /yield/, /perpetual/, /derivativ/, /liquid.staking/, /restaking/, /\bamm\b/] },
  { key: 'L2', label: 'Layer 2 și scalare', match: [/layer.2/, /\bl2\b/, /rollup/, /zk/, /optimistic/, /scaling/] },
  { key: 'L1', label: 'Layer 1', match: [/layer.1/, /\bl1\b/, /smart.contract.platform/, /\bpos\b/] },
  { key: 'PRIVACY', label: 'Privacy', match: [/privacy/, /anonym/, /mixer/, /zero.knowledge/] },
  { key: 'SOCIAL', label: 'Social și creator', match: [/social/, /creator/, /\bsocialfi\b/, /content/] },
  { key: 'PAYMENTS', label: 'Plăți', match: [/payment/, /remittance/, /stablecoin.protocol/] },
  { key: 'ECOSYSTEM', label: 'Ecosistem de lanț', match: [/ecosystem/, /chain$/] },
];

export function sectorOf(tags = [], categories = []) {
  const haystack = [...tags, ...categories].map((t) => String(t).toLowerCase());
  for (const s of SECTORS) {
    if (haystack.some((h) => s.match.some((re) => re.test(h)))) return s;
  }
  return null;
}

/**
 * Build the sector landscape from the universe plus CoinGecko categories.
 *
 * @param {{assets:any[], categories?:any[]|null, nowMs:number}} input
 * @returns {{sectors:Record<string, any>, ranked:any[], note:string, coverage:number}}
 */
export function narrativeLandscape({ assets, categories = null, nowMs }) {
  const bySector = new Map();
  let classified = 0;
  for (const a of assets ?? []) {
    const s = sectorOf(a.tags ?? [], [...(a.categories ?? []), ...(a.fundamentals?.category ? [a.fundamentals.category] : [])]);
    if (!s) continue;
    classified += 1;
    const list = bySector.get(s.key) ?? { ...s, members: [] };
    list.members.push(a);
    bySector.set(s.key, list);
  }

  // CoinGecko's own category rows give an independent read on each sector's 24h move.
  const catBySector = new Map();
  for (const c of categories ?? []) {
    const s = sectorOf([c.name ?? '', c.id ?? ''], []);
    if (!s) continue;
    const cur = catBySector.get(s.key) ?? { marketCap: 0, change24h: [], names: [] };
    if (isNum(c.market_cap)) cur.marketCap += c.market_cap;
    if (isNum(c.market_cap_change_24h)) cur.change24h.push(c.market_cap_change_24h);
    cur.names.push(c.name ?? c.id);
    catBySector.set(s.key, cur);
  }

  const sectors = {};
  for (const [key, group] of bySector) {
    const members = group.members;
    const ch7 = members.map((a) => a.market?.change?.d7).filter(isNum);
    const ch30 = members.map((a) => a.market?.change?.d30).filter(isNum);
    const ch24 = members.map((a) => a.market?.change?.h24).filter(isNum);
    const cat = catBySector.get(key) ?? null;

    const med7 = ch7.length ? median(ch7) : null;
    const med30 = ch30.length ? median(ch30) : null;
    const med24 = ch24.length ? median(ch24) : null;
    const catChange = cat?.change24h?.length ? mean(cat.change24h) : null;

    // Score: the sector's own 7d median dominates, with 30d as context and the category row as a
    // cross-check. A sector with fewer than 4 members cannot carry a confident score.
    let score = 50;
    if (isNum(med7)) score += clamp(med7 / 1.4, -26, 30);
    if (isNum(med30)) score += clamp(med30 / 5, -12, 14);
    if (isNum(catChange)) score += clamp(catChange / 2.5, -8, 8);
    const coverage = clamp(members.length / 8, 0, 1);

    sectors[key] = {
      key,
      label: group.label,
      members: members.length,
      symbols: members.sort((a, b) => (b.market?.marketCap ?? 0) - (a.market?.marketCap ?? 0)).slice(0, 8).map((a) => a.symbol),
      change24d: isNum(med24) ? round(med24, 2) : null,
      change7d: isNum(med7) ? round(med7, 2) : null,
      change30d: isNum(med30) ? round(med30, 2) : null,
      categoryChange24h: isNum(catChange) ? round(catChange, 2) : null,
      categoryMarketCap: cat?.marketCap ?? null,
      score: round(clamp(score, 0, 100), 1),
      coverage: round(coverage, 2),
      confident: members.length >= 4,
    };
  }

  const ranked = Object.values(sectors).sort((a, b) => b.score - a.score);
  return {
    sectors,
    ranked,
    coverage: round(classified / Math.max(1, (assets ?? []).length), 3),
    note: `narațiunile sunt derivate din etichetele proiectelor și, când sunt disponibile, din categoriile CoinGecko; un sector cu mai puțin de 4 membri este marcat ca neconcludent. Clasificate: ${classified} din ${(assets ?? []).length}.`,
    at: new Date(nowMs).toISOString(),
  };
}

/** Attach the sector verdict to one asset. */
export function assetNarrative(asset, landscape) {
  const s = sectorOf(asset.tags ?? [], [...(asset.categories ?? []), ...(asset.fundamentals?.category ? [asset.fundamentals.category] : [])]);
  if (!s) return { key: null, label: null, score: null, coverage: 0, members: 0, note: 'proiectul nu a putut fi încadrat într-un sector din etichetele disponibile' };
  const sec = landscape?.sectors?.[s.key];
  if (!sec) return { key: s.key, label: s.label, score: null, coverage: 0, members: 0, note: 'sectorul nu a putut fi evaluat în această rulare' };
  return {
    key: sec.key,
    label: sec.label,
    score: sec.confident ? sec.score : null,
    rawScore: sec.score,
    change7d: sec.change7d,
    change30d: sec.change30d,
    members: sec.members,
    peers: sec.symbols.filter((x) => x !== asset.symbol).slice(0, 5),
    coverage: sec.coverage,
    confident: sec.confident,
    note: sec.confident ? null : `sector cu doar ${sec.members} membri în universul scanat — scorul nu este folosit în ponderare`,
  };
}
