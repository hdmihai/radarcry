/**
 * RISK ENGINE — the second half of the project's central question:
 *
 *   „…și spune-mi ce riscuri pot invalida această ipoteză."
 *
 * A risk number alone does not answer that. What answers it is a list of **invalidators**: named,
 * observable conditions, each with the specific fact that would falsify the thesis, how to watch it,
 * and what it would mean if it fired. The score is the aggregate of those invalidators weighted by
 * severity — derived from the list, never the other way round.
 *
 * Risk is reported on 0..100 where **higher = more risk**, so the Early Research Candidate test
 * (`risk < 60`) reads naturally.
 */
import { clamp, isNum, round } from '../shared/math.js';
import { HOLDER_CLASSES } from '../onchain/labels.js';

export const SEVERITY = { CRITICAL: 'CRITICAL', HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' };
const SEVERITY_POINTS = { CRITICAL: 26, HIGH: 16, MEDIUM: 9, LOW: 4 };
export const SEVERITY_LABEL_RO = { CRITICAL: 'critic', HIGH: 'ridicat', MEDIUM: 'mediu', LOW: 'scăzut' };

export const RISK_CATEGORY = {
  CONTRACT: 'Contract și custodie',
  SUPPLY: 'Supply și deblocări',
  CONCENTRATION: 'Concentrare de deținători',
  LIQUIDITY: 'Lichiditate și ieșire',
  LEVERAGE: 'Levier și poziționare',
  DATA: 'Calitatea datelor',
  MARKET: 'Regim de piață',
  BEHAVIOUR: 'Comportament suspect',
};

/**
 * Build the invalidator list for one asset.
 * @param {{asset:any, market:any, changed:any}} input
 */
export function riskEngine({ asset, market, changed }) {
  const inv = [];
  const add = (o) => inv.push({ ...o, points: SEVERITY_POINTS[o.severity] ?? 0 });
  const oc = asset.onchain ?? {};
  const sec = oc.security ?? null;
  const cls = oc.classified ?? null;
  const supply = asset.risk?.supply ?? asset.supply ?? null;
  const d = asset.derivatives ?? null;
  const m = asset.market ?? {};

  /* ── contract and custody ──────────────────────────────────────────────────────────────────── */
  if (sec) {
    if (sec.isHoneypot === true) {
      add({ key: 'HONEYPOT', category: RISK_CATEGORY.CONTRACT, severity: SEVERITY.CRITICAL,
        label: 'Contractul se comportă ca un honeypot',
        invalidates: 'teza este nulă — vânzarea poate fi imposibilă',
        watch: 'simulare de vânzare GoPlus la fiecare rulare' });
    }
    if (sec.canTakeBackOwnership === true || sec.hiddenOwner === true) {
      add({ key: 'OWNER_CONTROL', category: RISK_CATEGORY.CONTRACT, severity: SEVERITY.CRITICAL,
        label: 'Owner-ul poate recăpăta controlul contractului',
        invalidates: 'regulile token-ului pot fi schimbate după ce intri',
        watch: 'câmpurile hidden_owner / can_take_back_ownership (GoPlus)' });
    }
    if (sec.isMintable === true) {
      add({ key: 'MINTABLE', category: RISK_CATEGORY.SUPPLY, severity: SEVERITY.HIGH,
        label: 'Supply-ul poate fi emis suplimentar (mintable)',
        invalidates: 'orice calcul de supply și FDV poate fi anulat printr-un mint',
        watch: 'funcția de mint și adresa care o poate apela' });
    }
    if (sec.canPause === true || sec.transferPausable === true) {
      add({ key: 'PAUSABLE', category: RISK_CATEGORY.CONTRACT, severity: SEVERITY.HIGH,
        label: 'Transferurile pot fi oprite din contract',
        invalidates: 'ieșirea poate fi blocată exact când contează',
        watch: 'transfer_pausable (GoPlus)' });
    }
    if (isNum(sec.sellTaxPct) && sec.sellTaxPct >= 10) {
      add({ key: 'SELL_TAX', category: RISK_CATEGORY.CONTRACT, severity: sec.sellTaxPct >= 25 ? SEVERITY.CRITICAL : SEVERITY.HIGH,
        label: `Taxă de vânzare ${round(sec.sellTaxPct, 1)}%`,
        invalidates: 'randamentul net poate fi anulat de taxa de ieșire',
        watch: 'sell_tax (GoPlus) — poate fi modificată de owner' });
    }
    if (sec.isProxy === true) {
      add({ key: 'PROXY', category: RISK_CATEGORY.CONTRACT, severity: SEVERITY.MEDIUM,
        label: 'Contract de tip proxy — logica poate fi înlocuită',
        invalidates: 'comportamentul auditat astăzi poate fi altul mâine',
        watch: 'adresa de implementare din proxy' });
    }
    if (sec.lpLockedPct !== null && isNum(sec.lpLockedPct) && sec.lpLockedPct < 50) {
      add({ key: 'LP_UNLOCKED', category: RISK_CATEGORY.LIQUIDITY, severity: SEVERITY.HIGH,
        label: `Doar ${round(sec.lpLockedPct, 0)}% din LP este blocat`,
        invalidates: 'lichiditatea poate fi retrasă, lăsând poziția fără ieșire',
        watch: 'lp_holders / lp_locked (GoPlus)' });
    }
  } else {
    add({ key: 'NO_SECURITY_SCAN', category: RISK_CATEGORY.DATA, severity: SEVERITY.MEDIUM,
      label: 'Contractul nu a putut fi scanat în această rulare',
      invalidates: 'riscurile de contract rămân necunoscute — nu înseamnă că nu există',
      watch: 'reluarea scanării GoPlus / lanț neacoperit' });
  }

  /* ── supply ────────────────────────────────────────────────────────────────────────────────── */
  if (supply) {
    if (supply.unlockWithin30d) {
      add({ key: 'UNLOCK_30D', category: RISK_CATEGORY.SUPPLY, severity: SEVERITY.HIGH,
        label: supply.unlockNote ?? 'Deblocare semnificativă în 30 de zile',
        invalidates: 'supply nou poate absorbi exact cererea pe care o detectăm',
        watch: supply.nextUnlock ? `data ${supply.nextUnlock.at.slice(0, 10)}` : 'calendarul de vesting al proiectului' });
    }
    if (isNum(supply.floatRatio) && supply.floatRatio < 0.3) {
      add({ key: 'LOW_FLOAT', category: RISK_CATEGORY.SUPPLY, severity: SEVERITY.MEDIUM,
        label: `Float mic: ${Math.round(supply.floatRatio * 100)}% din supply în circulație`,
        invalidates: 'prețul este ușor de mișcat în ambele direcții, iar restul supply-ului urmează',
        watch: 'creșterea supply-ului circulant între rulări' });
    }
    if (isNum(supply.fdvToMcap) && supply.fdvToMcap >= 4) {
      add({ key: 'EXTREME_FDV', category: RISK_CATEGORY.SUPPLY, severity: SEVERITY.MEDIUM,
        label: `FDV = ${round(supply.fdvToMcap, 1)}× capitalizarea`,
        invalidates: 'evaluarea completă presupune o creștere care nu s-a întâmplat încă',
        watch: 'raportul FDV/MCAP pe măsură ce supply-ul se eliberează' });
    }
    if (isNum(supply.inflationPctYear) && supply.inflationPctYear > 40) {
      add({ key: 'HIGH_EMISSION', category: RISK_CATEGORY.SUPPLY, severity: SEVERITY.MEDIUM,
        label: `Emisiune ~${round(supply.inflationPctYear, 0)}%/an`,
        invalidates: 'cererea trebuie să crească mai repede decât emisiunea doar pentru a sta pe loc',
        watch: supply.inflationBasis ?? 'supply circulant' });
    }
  }

  /* ── concentration ─────────────────────────────────────────────────────────────────────────── */
  const conc = isNum(cls?.top10EffectivePct) ? cls.top10EffectivePct : oc.top10Pct;
  if (isNum(conc)) {
    if (conc >= 70) {
      add({ key: 'CONCENTRATION_CRITICAL', category: RISK_CATEGORY.CONCENTRATION, severity: SEVERITY.CRITICAL,
        label: `Top 10 deținători efectivi: ${round(conc, 1)}% din supply tranzacționabil`,
        invalidates: 'o singură decizie de vânzare poate anula întreaga mișcare',
        watch: 'lista de deținători la fiecare rulare completă' });
    } else if (conc >= 50) {
      add({ key: 'CONCENTRATION_HIGH', category: RISK_CATEGORY.CONCENTRATION, severity: SEVERITY.HIGH,
        label: `Top 10 deținători efectivi: ${round(conc, 1)}%`,
        invalidates: 'câteva portofele pot schimba direcția',
        watch: 'variația cotelor din top 10' });
    } else if (conc >= 35) {
      add({ key: 'CONCENTRATION_MEDIUM', category: RISK_CATEGORY.CONCENTRATION, severity: SEVERITY.MEDIUM,
        label: `Top 10 deținători efectivi: ${round(conc, 1)}%`,
        invalidates: 'concentrarea rămâne un factor, deși nu dominant',
        watch: 'variația cotelor din top 10' });
    }
  } else {
    add({ key: 'NO_HOLDERS', category: RISK_CATEGORY.DATA, severity: SEVERITY.MEDIUM,
      label: 'Lista de deținători nu a fost disponibilă',
      invalidates: 'concentrarea rămâne necunoscută — factorul este scos din ponderare, nu presupus bun',
      watch: 'acoperirea lanțului în furnizorii gratuiți' });
  }
  if (isNum(cls?.flaggedSharePct) && cls.flaggedSharePct > 0.5) {
    add({ key: 'FLAGGED_HOLDERS', category: RISK_CATEGORY.BEHAVIOUR, severity: SEVERITY.HIGH,
      label: `Adrese semnalate dețin ${round(cls.flaggedSharePct, 2)}% din supply`,
      invalidates: 'fluxurile pot fi legate de adrese cu istoric problematic',
      watch: 'setul de etichete eth-labels / Arkham' });
  }

  /* ── liquidity ─────────────────────────────────────────────────────────────────────────────── */
  const liq = oc.liquidityUsd;
  const vol = m.volume24h;
  if (isNum(liq) && liq < 150_000) {
    add({ key: 'THIN_LIQUIDITY', category: RISK_CATEGORY.LIQUIDITY, severity: liq < 50_000 ? SEVERITY.CRITICAL : SEVERITY.HIGH,
      label: `Lichiditate DEX de doar ${Math.round(liq).toLocaleString('ro-RO')}$`,
      invalidates: 'ieșirea mută prețul mai mult decât câștigul așteptat',
      watch: 'adâncimea pool-urilor (DexScreener)' });
  }
  if (isNum(vol) && vol < 500_000) {
    add({ key: 'LOW_VOLUME', category: RISK_CATEGORY.LIQUIDITY, severity: SEVERITY.HIGH,
      label: `Volum de ${Math.round(vol).toLocaleString('ro-RO')}$/zi, sub pragul de 500k$`,
      invalidates: 'nu există contraparte suficientă pentru o poziție reală',
      watch: 'volumul 24h față de pragul din filtrul de small-cap' });
  }
  if (isNum(asset.derived?.turnover) && asset.derived.turnover > 1.5) {
    add({ key: 'WASH_SUSPECT', category: RISK_CATEGORY.BEHAVIOUR, severity: SEVERITY.HIGH,
      label: `Rotație de ${round(asset.derived.turnover * 100, 0)}% din capitalizare pe zi`,
      invalidates: 'volumul poate fi artificial, iar semnalul de flux fals',
      watch: 'raportul volum/capitalizare și numărul de piețe' });
  }
  if (isNum(cls?.lpSharePct) && cls.lpSharePct < 1 && isNum(liq) && liq > 0) {
    add({ key: 'LP_SHARE_LOW', category: RISK_CATEGORY.LIQUIDITY, severity: SEVERITY.LOW,
      label: `Pool-urile dețin doar ${round(cls.lpSharePct, 2)}% din supply`,
      invalidates: 'raportul dintre capitalizare și adâncime este fragil',
      watch: 'evoluția lichidității între rulări' });
  }

  /* ── leverage ──────────────────────────────────────────────────────────────────────────────── */
  if (d) {
    if (isNum(d.fundingPct8h) && d.fundingPct8h >= 0.05) {
      add({ key: 'FUNDING_DANGER', category: RISK_CATEGORY.LEVERAGE, severity: SEVERITY.HIGH,
        label: `Funding ${round(d.fundingPct8h, 4)}%/8h — zona de pericol`,
        invalidates: 'poziționarea este deja aglomerată; un long squeeze poate anula mișcarea',
        watch: 'funding pe fiecare bursă, la fiecare puls de 15 minute' });
    } else if (isNum(d.fundingPct8h) && d.fundingPct8h >= 0.015) {
      add({ key: 'FUNDING_CROWDED', category: RISK_CATEGORY.LEVERAGE, severity: SEVERITY.MEDIUM,
        label: `Funding ${round(d.fundingPct8h, 4)}%/8h — long-uri aglomerate`,
        invalidates: 'mișcarea este plătită de poziții cu levier, nu de cerere spot',
        watch: 'funding + open interest' });
    }
    if (isNum(d.oiToMcap) && d.oiToMcap > 0.25) {
      add({ key: 'OI_CONCENTRATION', category: RISK_CATEGORY.LEVERAGE, severity: SEVERITY.MEDIUM,
        label: `Open interest = ${Math.round(d.oiToMcap * 100)}% din capitalizare`,
        invalidates: 'o cascadă de lichidări poate domina prețul spot',
        watch: 'OI agregat / capitalizare' });
    }
  }

  /* ── market regime ─────────────────────────────────────────────────────────────────────────── */
  if (market?.regime?.state === 'RISK_OFF') {
    add({ key: 'RISK_OFF', category: RISK_CATEGORY.MARKET, severity: SEVERITY.MEDIUM,
      label: 'Regimul general de piață este risc-off',
      invalidates: 'într-un regim defensiv, semnalele de small-cap eșuează mai des',
      watch: 'regimul de piață și indicele altseason calculat local' });
  }
  if (isNum(market?.fearGreed?.value) && market.fearGreed.value >= 80) {
    add({ key: 'EUPHORIA', category: RISK_CATEGORY.MARKET, severity: SEVERITY.LOW,
      label: `Fear & Greed la ${market.fearGreed.value} — euforie`,
      invalidates: 'intrările târzii într-o piață euforică au cel mai slab raport risc/randament',
      watch: 'alternative.me Fear & Greed' });
  }

  /* ── data quality ──────────────────────────────────────────────────────────────────────────── */
  const confidence = asset.verdict?.confidence ?? asset.pre?.confidence ?? null;
  if (isNum(confidence) && confidence < 55) {
    add({ key: 'LOW_CONFIDENCE', category: RISK_CATEGORY.DATA, severity: SEVERITY.MEDIUM,
      label: `Încredere ${confidence}% — prea puțini factori măsurați`,
      invalidates: 'teza se bazează pe o parte mică din imaginea completă',
      watch: 'secțiunea „Acoperire surse” din dashboard' });
  }
  if ((asset.quality?.flags ?? []).includes('MCAP_DISAGREEMENT')) {
    add({ key: 'MCAP_DISAGREEMENT', category: RISK_CATEGORY.DATA, severity: SEVERITY.MEDIUM,
      label: 'CoinGecko și CoinMarketCap raportează capitalizări foarte diferite',
      invalidates: 'filtrul de small-cap și toate raportările la capitalizare devin incerte',
      watch: 'cele două surse, separat' });
  }
  if ((asset.quality?.flags ?? []).includes('STALE_QUOTE')) {
    add({ key: 'STALE_QUOTE', category: RISK_CATEGORY.DATA, severity: SEVERITY.LOW,
      label: 'Cotația de piață este mai veche de 6 ore',
      invalidates: 'prețul și volumul folosite pot fi depășite',
      watch: 'last_updated al furnizorului' });
  }
  const baselinePoints = asset.baseline?.points ?? null;
  if (isNum(baselinePoints) && baselinePoints < 4) {
    add({ key: 'SHORT_HISTORY', category: RISK_CATEGORY.DATA, severity: SEVERITY.MEDIUM,
      label: `Doar ${baselinePoints} puncte de istoric propriu`,
      invalidates: '„s-a schimbat ceva” nu poate fi măsurat corect fără o normă proprie',
      watch: 'acumularea istoricului la fiecare rulare completă' });
  }

  /* ── behaviour: the thesis contradicting itself ────────────────────────────────────────────── */
  if (changed?.simultaneous && (asset.onchain?.flows?.flags ?? []).includes('TEAM_TO_CEX')) {
    add({ key: 'TEAM_SELLING_INTO_STRENGTH', category: RISK_CATEGORY.BEHAVIOUR, severity: SEVERITY.CRITICAL,
      label: 'Trezoreria proiectului trimite către burse exact în timpul semnalului',
      invalidates: 'cererea detectată poate fi absorbită de vânzătorul cel mai informat',
      watch: 'mișcările adreselor de proiect față de soldul pe CEX' });
  }
  const projectShare = cls?.byClass?.[HOLDER_CLASSES.PROJECT]?.share;
  if (isNum(projectShare) && projectShare > 25) {
    add({ key: 'TREASURY_HEAVY', category: RISK_CATEGORY.CONCENTRATION, severity: SEVERITY.MEDIUM,
      label: `Adresele proiectului dețin ${round(projectShare, 1)}% din supply`,
      invalidates: 'oferta potențială este controlată de o singură entitate',
      watch: 'cotele adreselor de trezorerie' });
  }

  /* ── aggregate ─────────────────────────────────────────────────────────────────────────────── */
  const dataOnly = inv.filter((i) => i.category === RISK_CATEGORY.DATA);
  const real = inv.filter((i) => i.category !== RISK_CATEGORY.DATA);
  // Diminishing returns: the third "medium" risk adds less than the first.
  const sumWithDecay = (list) => {
    const sorted = [...list].sort((a, b) => b.points - a.points);
    return sorted.reduce((s, i, idx) => s + i.points * (idx === 0 ? 1 : idx === 1 ? 0.8 : idx === 2 ? 0.6 : 0.35), 0);
  };
  const accumulated = sumWithDecay(real) + sumWithDecay(dataOnly) * 0.5;

  /*
   * Severity floors. Accumulation alone under-reports the one case that matters most: a single
   * CRITICAL invalidator — a honeypot, an owner who can take the contract back, a treasury selling
   * into the very signal we detected — ends the thesis on its own, and must never land in the
   * "moderate" band just because nothing else fired. The floor is what makes `risc < 60` in the
   * Early Research Candidate rule mean what it says.
   */
  const hasReal = (severity) => real.some((i) => i.severity === severity);
  const floor = hasReal(SEVERITY.CRITICAL) ? 80 : hasReal(SEVERITY.HIGH) ? 55 : 0;
  const score = clamp(Math.round(Math.max(accumulated, floor)), 0, 100);
  const worst = inv.length ? inv.reduce((a, b) => (b.points > a.points ? b : a)) : null;

  return {
    score,
    level: score >= 75 ? 'CRITIC' : score >= 60 ? 'RIDICAT' : score >= 40 ? 'MODERAT' : score >= 20 ? 'SCĂZUT' : 'MINIM',
    invalidators: inv.sort((a, b) => b.points - a.points),
    top: inv.slice(0, 3),
    worst,
    counts: {
      critical: inv.filter((i) => i.severity === SEVERITY.CRITICAL).length,
      high: inv.filter((i) => i.severity === SEVERITY.HIGH).length,
      medium: inv.filter((i) => i.severity === SEVERITY.MEDIUM).length,
      low: inv.filter((i) => i.severity === SEVERITY.LOW).length,
    },
    note: 'Riscul este suma invalidatorilor, nu o opinie: fiecare rând spune ce ar falsifica teza și unde se urmărește.',
  };
}
