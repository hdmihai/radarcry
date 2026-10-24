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
  for (const [name, fn] of Object.entries({ heroMarkup, discoveryMarkup, futuresMarkup, researchMarkup, parityMarkup, radarMarkup, analogsMarkup, catalystsMarkup, derivativesMarkup, narrativesMarkup, trackMarkup, healthMarkup, methodologyMarkup, topMeta, marketStrip })) {
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
