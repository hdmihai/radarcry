/**
 * Frontend smoke test without a browser: the view modules are pure functions from the published
 * contract to markup, so every view and every research card can be rendered in Node.
 * Guards against crashes and against leaking "undefined" / "NaN" into the dashboard.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { runFixtureDays } from '../fixture-run.js';
import { indexSnapshot } from '../../web/assets/js/core/store.js';
import { initLabels } from '../../web/assets/js/core/labels.js';
import { heroMarkup } from '../../web/assets/js/views/hero.js';
import { radarMarkup } from '../../web/assets/js/views/radar.js';
import { analogsMarkup } from '../../web/assets/js/views/analogs.js';
import { catalystsMarkup } from '../../web/assets/js/views/catalysts.js';
import { derivativesMarkup, narrativesMarkup } from '../../web/assets/js/views/markets.js';
import { trackMarkup } from '../../web/assets/js/views/track.js';
import { healthMarkup } from '../../web/assets/js/views/health.js';
import { methodologyMarkup } from '../../web/assets/js/views/methodology.js';
import { marketStrip, noticeMarkup, notices, topMeta } from '../../web/assets/js/views/shell.js';
import { discoveryMarkup, discoveryState } from '../../web/assets/js/views/discovery.js';
import { futuresMarkup, futuresState } from '../../web/assets/js/views/futures.js';
import { researchMarkup, researchState } from '../../web/assets/js/views/research.js';
import { parityMarkup } from '../../web/assets/js/views/parity.js';
import { drawerMarkup } from '../../web/assets/js/views/drawer.js';
import { validityMarkup, validityState } from '../../web/assets/js/views/validity.js';
import { validityBadge } from '../../web/assets/js/views/widgets.js';
import { esc, html, tip } from '../../web/assets/js/core/dom.js';

let run;
let snap;
before(async () => {
  run = await runFixtureDays({ days: 3 });
  snap = indexSnapshot(JSON.parse(JSON.stringify(run.snapshots.at(-1))));
  initLabels(snap.methodology);
});
after(async () => run?.cleanup());

const clean = (name, markup) => {
  const s = String(markup);
  assert.ok(s.length > 200, `${name} rendered almost nothing`);
  for (const bad of ['undefined', 'NaN', '[object Object]']) assert.equal(s.includes(bad), false, `${name} leaks "${bad}"`);
  return s;
};

test('escaping: interpolated values are escaped, tooltips are escaped exactly once', () => {
  assert.equal(String(html`<b>${'<img onerror=x>'}</b>`), '<b>&lt;img onerror=x&gt;</b>');
  assert.equal(String(tip(html`<b>${'a&b'}</b>`)), esc('<b>a&amp;b</b>'));
  assert.equal(String(html`<i data-tip="${tip('x<y')}"></i>`), '<i data-tip="x&amp;lt;y"></i>');
});

test('every view renders from the contract', () => {
  for (const [name, fn] of Object.entries({ heroMarkup, discoveryMarkup, futuresMarkup, researchMarkup, parityMarkup, radarMarkup, analogsMarkup, catalystsMarkup, derivativesMarkup, narrativesMarkup, trackMarkup, healthMarkup, methodologyMarkup, validityMarkup, topMeta, marketStrip })) {
    clean(name, fn(snap));
  }
  const n = notices(snap);
  assert.ok(n.some((x) => x.kind === 'demo'), 'fixture snapshots announce DEMO mode');
  clean('notices', noticeMarkup(n));
});

test('every research card renders, on desktop and narrow layouts', () => {
  for (const c of snap.candidates) {
    const wide = clean(`drawer ${c.symbol}`, drawerMarkup(c, snap));
    if (c.depth === 'deep' && c.chart?.h4?.length) assert.ok(wide.includes('Structură 4H'), `${c.symbol} deep card shows the 4H chart`);
    if (!c.chart) assert.ok(wide.includes('Fără lumânări'), `${c.symbol} explains the missing candles`);
  }
  const deep = snap.candidates.find((c) => c.depth === 'deep');
  clean('drawer narrow', drawerMarkup(deep, snap, { narrow: true }));
});

test('research card shows Arkham wallet intelligence, or how to enable it', () => {
  const withFlows = snap.candidates.find((c) => c.onchain?.walletFlows);
  assert.ok(withFlows, 'demo snapshot carries Arkham flows');
  const card = clean('drawer arkham', drawerMarkup(withFlows, snap));
  assert.ok(card.includes('Fluxuri portofele și entități'));
  const noKey = { ...snap, health: { ...snap.health, providers: snap.health.providers.map((p) => (p.id === 'arkham' ? { ...p, status: 'NOT_CONFIGURED' } : p)) } };
  const bare = { ...withFlows, onchain: { ...withFlows.onchain, walletFlows: null } };
  assert.ok(String(drawerMarkup(bare, noKey)).includes('ARKHAM_API_KEY'));
});


/* ─────────────────────── the three primary sections, in every state they can reach ─────────── */

test('the Small-Cap Radar renders under every filter and never lands on a blank screen', () => {
  const before = discoveryState.filter;
  try {
    for (const f of [null, 'answer', 'early', 'simultaneous', 'all']) {
      discoveryState.filter = f;
      const markup = clean(`discovery[${f ?? 'auto'}]`, discoveryMarkup(snap));
      assert.ok(markup.includes('Small-Cap Radar'));
      // The question itself is on the screen, verbatim: it is what the section answers.
      assert.ok(markup.includes('mișcarea să devină evidentă'), 'the question is printed on the screen');
    }
    // With the default (auto) filter the screen shows rows whenever any bucket has them.
    discoveryState.filter = null;
    const auto = String(discoveryMarkup(snap));
    if ((snap.discovery?.rows ?? []).length) {
      assert.ok(auto.includes('dcard') || auto.includes('Niciun proiect'), 'either rows or an explained empty state');
      assert.ok(auto.includes('dcard'), 'the auto filter resolves to a bucket that has rows');
    }
  } finally {
    discoveryState.filter = before;
  }
});

test('a discovery card shows the three-part test, the thesis and the invalidators', () => {
  const rows = snap.discovery?.rows ?? [];
  assert.ok(rows.length > 0, 'the demo snapshot carries discovery rows');
  const before = discoveryState.filter;
  try {
    discoveryState.filter = 'all';
    const markup = String(discoveryMarkup(snap));
    assert.ok(markup.includes('Ce s-a schimbat'), 'what changed');
    assert.ok(markup.includes('Scor, factor cu factor'), 'the score is broken down');
    assert.ok(markup.includes('Ce ar invalida teza'), 'the risks that would falsify the thesis');
    assert.ok(markup.includes('Verifică manual'), 'the manual verification path per platform');
    // Every row states its stage, which is half of the candidate test.
    for (const r of rows.slice(0, 5)) assert.ok(markup.includes(`Stage ${r.verdict.stage}`), `${r.symbol} shows its stage`);
  } finally {
    discoveryState.filter = before;
  }
});

test('the Futures Radar renders graded and ungraded, and prints the hard filters it applied', () => {
  const before = futuresState.only;
  try {
    for (const only of [null, 'graded', 'all']) {
      futuresState.only = only;
      const markup = clean(`futures[${only ?? 'auto'}]`, futuresMarkup(snap));
      assert.ok(markup.includes('Futures Radar'));
      assert.ok(markup.includes('25') && markup.includes('30'), 'the block weights are visible');
    }
    futuresState.only = 'all';
    const all = String(futuresMarkup(snap));
    const capped = (snap.futures?.rows ?? []).filter((r) => r.grade.caps.length || r.grade.blocked.length);
    if (capped.length) assert.ok(all.includes('Filtru dur activ') || all.includes('Notă plafonată'), 'an applied hard filter is shown, not hidden');
    // Research-only is stated on the screen that could most easily be mistaken for a trading tool.
    assert.ok(all.includes('nu execută'), 'the screen states that nothing is executed');
  } finally {
    futuresState.only = before;
  }
});

test('the Deep Research dossier renders for every project that has a full file', () => {
  const rows = (snap.discovery?.rows ?? []).filter((r) => r.onchain?.holderTable || r.comparison);
  assert.ok(rows.length > 0, 'the demo snapshot carries at least one full dossier');
  const before = researchState.key;
  try {
    for (const r of rows.slice(0, 6)) {
      researchState.key = r.key;
      const markup = clean(`dossier ${r.symbol}`, researchMarkup(snap));
      assert.ok(markup.includes('Răspunsul la întrebarea proiectului'), `${r.symbol} answers the question explicitly`);
      assert.ok(markup.includes('Teza, în proză'), `${r.symbol} has a readable thesis`);
      assert.ok(markup.includes('Toți invalidatorii'), `${r.symbol} lists every invalidator`);
      assert.ok(markup.includes('Verificare manuală pe platforme'), `${r.symbol} offers the manual path`);
      if (r.onchain.holderTable) {
        assert.ok(markup.includes('clasificați în actori'), `${r.symbol} classifies its holders`);
        assert.ok(markup.includes('Top 10 efectiv'), `${r.symbol} shows effective concentration`);
      }
    }
    // An unknown key falls back to the first available dossier rather than rendering nothing.
    researchState.key = 'does-not-exist';
    clean('dossier fallback', researchMarkup(snap));
  } finally {
    researchState.key = before;
  }
});

test('the parity screen publishes the matrix, the gaps and the free-plan consumption', () => {
  const markup = clean('parity', parityMarkup(snap));
  assert.ok(markup.includes('permanent'), 'the permanent figure is labelled as such');
  assert.ok(markup.includes('cu cheile gratuite opționale'));
  assert.ok(markup.includes('atins în această rulare'));
  assert.ok(markup.includes('Matricea de capabilități'));
  assert.ok(markup.includes('Chei gratuite'), 'every optional key is listed with its signup step');
  for (const s of snap.methodology?.secrets ?? []) assert.ok(markup.includes(s.env), `${s.env} is documented on the screen`);
  if (snap.quota) assert.ok(markup.includes('Consumul planurilor gratuite'));
});

test('the dashboard states the free-only, research-only policy wherever it matters', () => {
  assert.equal(snap.meta.policy.unknownIsBearish, false);
  assert.equal(snap.meta.policy.subscriptionsUsed, false);
  assert.equal(snap.meta.policy.freeOnly, true);
  assert.equal(snap.meta.scope.tradeExecution, false);
  // Every provider in the health table declares the free plan it runs on.
  for (const p of snap.health.providers) assert.ok(p.plan && p.plan.length > 3, `${p.id} declares its plan`);
});

/* ─────────────────────── the whole horizon: list rows and the Univers screen ─────────────────── */

test('the Small-Cap Radar renders every level of evidence and pages the long list', () => {
  const rows = snap.discovery?.rows ?? [];
  const levels = new Set(rows.map((r) => r.detail));
  assert.ok(levels.has('full'), 'the top of the ranking carries the full file');
  const before = { ...discoveryState };
  try {
    discoveryState.filter = 'all';
    discoveryState.shown = 10_000;
    const all = clean('discovery[all levels]', discoveryMarkup(snap));
    if (levels.has('list')) assert.ok(all.includes('data-detail="list"'), 'list rows render as compact cards');
    discoveryState.shown = 30;
    const paged = String(discoveryMarkup(snap));
    if (rows.length > 30) assert.ok(paged.includes('data-dmore'), 'a long list is paged');
    const unpublished = (snap.discovery.analysed ?? 0) - rows.length;
    if (unpublished > 0) assert.ok(paged.includes('#/univers'), 'and points to the Univers screen for the rest of the horizon');
  } finally {
    Object.assign(discoveryState, before);
  }
});

test('the Univers screen renders while loading, once loaded, and when the table is missing', async () => {
  const { universeMarkup, universeState, decodeTable } = await import('../../web/assets/js/views/universe.js');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const saved = { ...universeState };
  try {
    universeState.status = 'loading';
    assert.ok(String(universeMarkup(snap)).includes('Se încarcă'), 'a loading state, not a blank screen');

    const doc = JSON.parse(await readFile(join(run.outDir, 'universe.json'), 'utf8'));
    universeState.status = 'ready';
    universeState.data = { ...doc, assetRows: decodeTable(doc.assets), futuresRows: decodeTable(doc.futures) };
    for (const [k, v] of [['alpha', 'ALL'], ['alpha', 'ANY'], ['alpha', 'BOTH'], ['only', 'perps'], ['only', 'simultaneous'], ['sort', 'opportunity'], ['sort', 'mcap'], ['stage', '1']]) {
      universeState[k] = v;
      clean(`univers[${k}=${v}]`, universeMarkup(snap));
    }
    universeState.alpha = 'ALL';
    universeState.only = 'ALL';
    universeState.stage = 'ALL';
    universeState.sort = 'rank';
    universeState.valid = 'ALL';
    universeState.shown = 10_000;
    const table = String(universeMarkup(snap));
    assert.ok(table.includes('Gate Alpha'), 'the Alpha programmes are visible per row');
    universeState.shown = 100;
    assert.ok(String(universeMarkup(snap)).includes('data-umore') || doc.assets.rows.length <= 100, 'a long table is paged');
    universeState.tab = 'futures';
    assert.ok(clean('univers[futures]', universeMarkup(snap)).includes('Nivele de research'));

    universeState.status = 'error';
    universeState.error = 'HTTP 404';
    assert.ok(String(universeMarkup(snap)).includes('HTTP 404'));
    assert.ok(String(universeMarkup({ ...snap, meta: { ...snap.meta, universe: undefined } })).includes('nu are încă'), 'an older snapshot explains the missing table');
  } finally {
    Object.assign(universeState, saved);
  }
});

/* ─────────────────────── the validity gate on every screen that lists projects ─────────────── */

test('the Validare screen lists the rules, the counts and every project held back, with the reason', () => {
  const v = snap.validity;
  assert.ok(v, 'the demo snapshot carries the gate');
  const saved = { ...validityState };
  try {
    validityState.tab = 'rejected';
    validityState.q = '';
    const rejected = clean('validare[rejected]', validityMarkup(snap));
    assert.ok(rejected.includes('Validare'));
    for (const c of v.checks) assert.ok(rejected.includes(c.label), `the rule "${c.label}" is printed`);
    assert.ok(rejected.includes('„Necunoscut” nu înseamnă „respins”'), 'unknown is not bearish, on the screen');
    if (v.rejected.length) assert.ok(rejected.includes(v.rejected[0].symbol), 'the first rejected project is listed');
    validityState.tab = 'pending';
    const pending = clean('validare[pending]', validityMarkup(snap));
    if (v.pending.length) assert.ok(pending.includes(v.pending[0].symbol));
    validityState.q = 'zzzz-nothing';
    assert.ok(String(validityMarkup(snap)).includes('Șterge căutarea'), 'an empty search explains itself');
    assert.ok(String(validityMarkup({ ...snap, validity: undefined })).includes('nu are încă'), 'an older snapshot explains the missing gate');
  } finally {
    Object.assign(validityState, saved);
  }
});

test('every listed project carries its verdict: Small-Cap Radar, CRI radar, dossier, research card, methodology', () => {
  const rows = snap.discovery?.rows ?? [];
  assert.ok(rows.every((r) => r.validity?.status === 'VALID'), 'only verified projects on the Small-Cap Radar');
  const before = discoveryState.filter;
  try {
    discoveryState.filter = 'all';
    const disc = String(discoveryMarkup(snap));
    assert.ok(disc.includes('verificat'), 'the badge is on the cards');
    assert.ok(disc.includes('Verificare de validitate'), 'with the checks one click away');
    assert.ok(disc.includes('#/validare'), 'and the way to the projects held back');
  } finally {
    discoveryState.filter = before;
  }
  const radar = String(radarMarkup(snap));
  assert.ok(radar.includes('verificarea de validitate'), 'the radar says its rows passed the gate');
  assert.ok(radar.includes('vpill'), 'with a compact verdict per row');
  const dossier = rows.find((r) => r.onchain?.holderTable || r.comparison);
  if (dossier) {
    const savedKey = researchState.key;
    researchState.key = dossier.key;
    try {
      assert.ok(String(researchMarkup(snap)).includes('Verificarea de validitate'), 'the dossier shows the gate');
    } finally {
      researchState.key = savedKey;
    }
  }
  const card = String(drawerMarkup(snap.candidates[0], snap));
  assert.ok(card.includes('Verificare de validitate'), 'the research card shows the gate');
  assert.ok(card.includes('<dt>Spot</dt>'), 'and every spot market it is listed on');
  const method = String(methodologyMarkup(snap));
  assert.ok(method.includes('Poarta de validitate'), 'the methodology explains the gate');
  // Regression: since contract v4 the legacy weights moved under methodology.similarity and the
  // signal thresholds were no longer published, so this screen printed "CRI ≥ ," with no number.
  const sig = snap.methodology.thresholds.signals;
  assert.ok(sig?.buySetup?.minCri > 0, 'the signal thresholds are published');
  assert.ok(method.includes(`CRI ≥ ${sig.buySetup.minCri}`), 'and printed');
  assert.ok(!/≥ ,|≥ <|cu {2}puncte/.test(method), 'no threshold is left blank');
  assert.ok(method.includes('Similaritate LAB/BTW/AGT'), 'the domain weights are drawn');
  assert.ok(method.includes('Float circulant'), 'the fingerprint features are listed');
});

test('the validity badge: verified, verified with warnings, pending, rejected', () => {
  const checks = [{ key: 'scope', label: 'Capitalizare', status: 'PASS', detail: '50 mil $' }];
  assert.equal(String(validityBadge(null)), '');
  assert.match(String(validityBadge({ status: 'VALID', label: 'verificat', checks, warnings: [] })), /verificat<\/span>$/);
  assert.match(String(validityBadge({ status: 'VALID', label: 'verificat', checks, warnings: ['a', 'b'] })), /verificat · 2 atenționări/);
  assert.match(String(validityBadge({ status: 'REJECTED', label: 'respins', checks, warnings: [] })), /data-tone="serious"/);
  assert.match(String(validityBadge({ status: 'PENDING', label: 'în verificare', checks, warnings: [] }, { compact: true })), /în verificare/);
});

test('the Univers screen shows only verified projects by default, and every held-back one on request', async () => {
  const { universeMarkup, universeState, decodeTable } = await import('../../web/assets/js/views/universe.js');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const saved = { ...universeState };
  try {
    const doc = JSON.parse(await readFile(join(run.outDir, 'universe.json'), 'utf8'));
    universeState.status = 'ready';
    universeState.data = { ...doc, assetRows: decodeTable(doc.assets), futuresRows: decodeTable(doc.futures) };
    universeState.tab = 'assets';
    universeState.shown = 10_000;
    universeState.valid = 'V';
    const rows = universeState.data.assetRows;
    const verified = clean('univers[V]', universeMarkup(snap));
    assert.ok(verified.includes('id="uvalid"'), 'the validity filter is offered');
    const rejected = rows.filter((r) => r.valid === 'R');
    if (rejected.length) assert.equal(verified.includes(`>${rejected[0].symbol}<`), rows.some((r) => r.valid === 'V' && r.symbol === rejected[0].symbol), 'a rejected project is not in the default view');
    universeState.valid = 'R';
    const held = clean('univers[R]', universeMarkup(snap));
    if (rejected.length) {
      assert.ok(held.includes('respins'), 'rejected rows say so');
      assert.ok(held.includes(`>${rejected[0].symbol}<`));
    }
    universeState.valid = 'P';
    clean('univers[P]', universeMarkup(snap));

    // A table published before the gate has no validity column: every row stays visible.
    const fields = doc.assets.fields.filter((f) => !['valid', 'validWhy', 'validWarn'].includes(f));
    const idx = fields.map((f) => doc.assets.fields.indexOf(f));
    const old = { ...doc, assets: { fields, rows: doc.assets.rows.map((r) => idx.map((i) => r[i])) } };
    universeState.data = { ...old, assetRows: decodeTable(old.assets), futuresRows: decodeTable(old.futures) };
    universeState.valid = 'V';
    const legacy = clean('univers[legacy]', universeMarkup(snap));
    assert.ok(!legacy.includes('id="uvalid"'), 'no filter without the column');
    assert.ok(legacy.includes(`${universeState.data.assetRows.length} proiecte`) || legacy.includes(`${universeState.data.assetRows.length.toLocaleString('ro-RO')} proiecte`), 'all rows shown');
  } finally {
    Object.assign(universeState, saved);
  }
});
