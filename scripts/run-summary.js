#!/usr/bin/env node
/**
 * Render a run summary for the GitHub Actions job page, read from the published contract.
 *
 * It answers, in the place a maintainer actually looks, the only questions worth asking after a run:
 * did anything satisfy the project's question, what nearly did, how much of the commercial parity
 * was achieved, and is any free plan close to its limit.
 *
 *   node scripts/run-summary.js data/latest.json >> "$GITHUB_STEP_SUMMARY"
 */
import { readFile } from 'node:fs/promises';

const n = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pct = (x) => (Number.isFinite(x) ? `${x > 0 ? '+' : ''}${x.toFixed(1)}%` : '—');
const usd = (x) => {
  if (!Number.isFinite(x)) return '—';
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e3) return `$${(x / 1e3).toFixed(0)}K`;
  return `$${x.toFixed(0)}`;
};

const f0 = (snap) => snap.futures?.summary?.scanned ?? 0;
const path = process.argv[2] ?? 'data/latest.json';
const s = JSON.parse(await readFile(path, 'utf8'));
const d = s.discovery ?? {};
const rows = d.rows ?? [];
const out = [];

out.push(`### CRI Radar — ${s.meta.mode === 'fixture' ? 'DEMO' : 'LIVE'} · ${s.meta.generatedAt}`);
out.push('');
out.push(`**Întrebarea proiectului:** ${d.answering ?? 0} ${(d.answering ?? 0) === 1 ? 'proiect răspunde' : 'proiecte răspund'} · ${d.earlyCandidates ?? 0} candidați timpurii · ${d.analysed ?? 0} analizate în adâncime din ${s.health?.universe?.eligible ?? '—'} eligibile`);
out.push('');
out.push(`Sănătate date: **${s.health?.overall}** · paritate atinsă **${n(s.parity?.achieved)}%** (permanent ${n(s.parity?.permanent)}%, cu chei ${n(s.parity?.withKeys)}%) · durată ${((s.meta.durationMs ?? 0) / 1000).toFixed(1)} s`);
const u = s.health?.universe ?? {};
out.push('');
out.push(`Orizont: CoinGecko ${u.coingecko ?? 0} · CoinMarketCap ${u.coinmarketcap ?? 0}${u.coinmarketcap ? '' : ' (adaugă CMC_API_KEY, cheie Basic gratuită)'} · Binance Alpha ${u.binanceAlpha ?? 0} · Gate Alpha ${u.gateAlpha ?? 0} (${u.alphaOnly ?? 0} tokenuri Alpha în afara top 1000) → ${u.eligible ?? 0} eligibile · ${u.deep ?? 0} cercetate în profunzime (prioritate ${u.priority ?? '—'}) · ${u.futures ?? f0(s)} piețe perpetue`);

const answering = rows.filter((r) => r.verdict?.answersQuestion);
const shown = answering.length ? answering : [...rows].sort((a, b) => (b.verdict?.opportunity ?? 0) - (a.verdict?.opportunity ?? 0)).slice(0, 8);
if (shown.length) {
  out.push('');
  out.push(answering.length ? '#### Proiecte care răspund la întrebare' : '#### Cele mai apropiate de întrebare (niciunul nu îndeplinește toate cele trei condiții)');
  out.push('');
  out.push('| Proiect | Stadiu | Oportunitate | Precocitate | Risc | Schimbări | Ce îi lipsește |');
  out.push('|---|---|---:|---:|---:|---|---|');
  for (const r of shown) {
    const v = r.verdict ?? {};
    const missing = (v.tests ?? []).filter((t) => !t.pass).map((t) => t.key).join(', ') || '—';
    out.push(`| **${r.symbol}** ${r.name ? `<br><sub>${r.name} · ${usd(r.market?.marketCap)}</sub>` : ''} | ${v.stage} ${v.stageLabel ?? ''} | ${n(v.opportunity)} | ${v.earliness ?? '—'} | ${n(v.risk, 0)} | ${r.changed?.count ?? 0} în ${r.changed?.familyCount ?? 0} familii | ${missing} |`);
  }
}

const f = s.futures?.summary ?? {};
out.push('');
out.push(`#### Futures Radar — ${f.graded ?? 0} din ${f.scanned ?? 0} cu notă${f.best ? ` · cel mai bun: **${f.best.symbol} ${f.best.grade}** (${n(f.best.score)})` : ''}`);

const alerts = s.alerts?.counts ?? {};
if ((alerts.urgent ?? 0) + (alerts.important ?? 0) > 0) {
  out.push('');
  out.push(`#### Alerte: ${alerts.urgent ?? 0} urgente, ${alerts.important ?? 0} importante`);
  for (const a of (s.alerts?.items ?? []).filter((x) => x.level !== 'INFO').slice(0, 10)) {
    out.push(`- **${a.title}** — ${a.detail}`);
  }
}

const strained = (s.quota?.providers ?? []).filter((p) => p.paused || (p.shareMonth ?? p.shareDay ?? 0) >= 70);
if (strained.length) {
  out.push('');
  out.push('#### Planuri gratuite de urmărit');
  for (const p of strained) {
    out.push(`- ${p.paused ? '⏸ ' : ''}**${p.label}**: ${n(p.shareMonth ?? p.shareDay, 0)}% consumat${p.projectedShare ? `, proiecție lună ${n(p.projectedShare, 0)}%` : ''}${p.reason ? ` — ${p.reason}` : ''}`);
  }
}

const failing = (s.health?.providers ?? []).filter((p) => !['OK', 'NOT_CONFIGURED', 'SKIPPED'].includes(p.status));
if (failing.length) {
  out.push('');
  out.push('#### Surse care nu au răspuns');
  for (const p of failing) out.push(`- **${p.label}**: ${p.status} ${p.message ?? ''}`);
  out.push('');
  out.push('_Factorii afectați sunt marcați „necunoscut”: scad încrederea și acoperirea, fără să conteze ca dovezi negative._');
}

out.push('');
out.push(`_${s.meta.disclaimer}_`);
void pct;
console.log(out.join('\n'));
