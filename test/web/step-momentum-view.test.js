/**
 * Ecranul „Momentum în trepte", fără browser. View-ul nu calculează: randează documentul motorului.
 * Păzește coloana „Sectoare": pastilele trebuie să iasă markup real (nu text escapat), un fișier publicat
 * înainte de coloană (fără `sectors`) nu are voie să arunce, iar valorile din date se escapează.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepMomentumMarkup, stepMomentumState } from '../../frontend/assets/js/views/step-momentum.js';
import { DASH } from '../../frontend/assets/js/core/format.js';

const item = (extra = {}) => ({
  key: 'cg:aaa', symbol: 'AAA', name: 'Aaa', marketCap: 2e7, volume24h: 1e6, futuresOnly: false,
  score: 6, known: 7, conditions: {}, metrics: { outperformance7dPct: 12, gainFrom20dLowPct: 30, openInterestChange14dPct: 40, longShortTaker: 1.1 },
  sources: {}, ...extra,
});

function render(items) {
  stepMomentumState.status = 'ready';
  stepMomentumState.error = null;
  stepMomentumState.data = { method: 'rules', rules: [], notes: [], stepMomentumMeta: {}, stepMomentum: items };
  return String(stepMomentumMarkup());
}

test('sectoarele ies ca pastile reale, cu eticheta și momentumul sectorului', () => {
  const out = render([item({ sectors: ['ai-agents', 'meme-token'], sectorMomentum: { 'ai-agents': 12.34 } })]);
  assert.ok(out.includes('<span class="pill" data-tone="muted"'), 'pastila trebuie să fie element, nu text');
  assert.ok(!out.includes('&lt;span'), 'markup-ul propriu nu are voie să fie escapat a doua oară');
  assert.match(out, />AI Agents \+12\.3%<\/span>/);
  assert.match(out, />Meme<\/span>/, 'sector fără momentum: doar eticheta');
});

test('fără sectoare: liniuță; un fișier vechi, fără câmpurile noi, nu aruncă', () => {
  assert.ok(render([item({ sectors: [] })]).includes(`<td>${DASH}</td>`));
  assert.doesNotThrow(() => render([item()]));
  assert.ok(render([item()]).includes(`<td>${DASH}</td>`));
  // momentum prezent, dar `sectors` lipsă: vechea formă `item.sectors[0]` arunca aici
  assert.doesNotThrow(() => render([item({ sectorMomentum: { 'ai-agents': 3 } })]));
});

test('un id de sector ostil este escapat, nu randat', () => {
  const out = render([item({ sectors: ['<img src=x onerror=alert(1)>'] })]);
  assert.ok(!out.includes('<img'), 'nu trebuie să existe element injectat');
  assert.ok(out.includes('&lt;img'));
});
