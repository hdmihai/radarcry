/**
 * Ecranul „Research Python" — cross-sectional, fără browser.
 * View-ul randează exact ce publică motorul Python prin attach-research.
 * Păzește: fallback calm când `snap.research` lipsește (CI fail-soft), `—` pentru
 * câmpurile documentate ca indisponibile (nu 0, nu N/A), top 15 pe outperformance,
 * sortarea lichidității cu cele cu composite întâi, și escaparea simbolurilor ostile.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchPythonMarkup, researchPythonCount } from '../../frontend/assets/js/views/research-python.js';
import { DASH } from '../../frontend/assets/js/core/format.js';

const feat = (over = {}) => ({
  outperformance7d: 5, momentumComposite: 3.14, turnover: 0.4, earliness: 0.6, oiChangePct: 1.2,
  benchmark: 'crossSectionalMedian', benchmarkValue: 0, gaps: [], ...over,
});
const fut = (over = {}) => ({
  nodeFuturesScore: 80, researchComposite: 0.5, agreement: 0.3, gaps: [], ...over,
});
const snapWithResearch = ({ features = {}, futures = {} } = {}) => ({
  meta: { generatedAt: '2026-01-01T00:00:00Z' },
  candidates: [],
  research: {
    momentum: { meta: { schemaVersion: '4.0.0', discoveryCount: 120, futuresCount: 40, squeezeCount: 40 }, features },
    liquidity: { meta: { schemaVersion: '4.0.0', discoveryCount: 120, futuresCount: 40, squeezeCount: 40 }, discovery: {}, futures },
  },
});
const leaks = (s) => /undefined|NaN|\bnull\b|\[object/.test(String(s));

test('fallback: fără snap.research → mesaj calm, nu eroare', () => {
  const out = String(researchPythonMarkup({ meta: {}, candidates: [] }));
  assert.ok(out.includes('Research Python'));
  assert.ok(out.includes('nu e publicat încă'));
  assert.ok(!leaks(out), 'fără undefined/null/NaN');
});

test('researchPythonCount: null fără features, count real cu ele', () => {
  assert.equal(researchPythonCount({}), null);
  assert.equal(researchPythonCount({ research: { momentum: { features: {} } } }), 0);
  assert.equal(researchPythonCount({ research: { momentum: { features: { A: {}, B: {} } } } }), 2);
});

test('momentum: top 15 după outperformance7d, ordine descrescătoare', () => {
  const features = {};
  for (let i = 1; i <= 30; i += 1) features[`S${String(i).padStart(2, '0')}`] = feat({ outperformance7d: i });
  const out = String(researchPythonMarkup(snapWithResearch({ features })));
  assert.ok(out.includes('<b>S30</b>'), 'S30 trebuie în top');
  assert.ok(out.includes('<b>S16</b>'), 'S16 e #15');
  assert.ok(!out.includes('<b>S15</b>'), 'S15 e exclus din top 15');
  assert.ok(!out.includes('<b>S01</b>'), 'S01 e exclus');
});

test('lipsa turnover / earliness / oiChangePct → — (nu 0, nu N/A)', () => {
  const features = { X: feat({ turnover: null, earliness: null, oiChangePct: null }) };
  const out = String(researchPythonMarkup(snapWithResearch({ features })));
  assert.ok(out.includes(DASH), 'cel puțin un —');
  assert.ok(!out.includes('N/A'));
  assert.ok(!out.includes('>0.0%<'), 'turnover lipsă nu trebuie să apară ca 0.0%');
});

test('liquidity: cele cu composite apar primele, restul cu — pe composite/agreement', () => {
  const futures = {
    AAA: fut({ nodeFuturesScore: 95, researchComposite: null, agreement: null, gaps: ['researchComposite', 'agreement'] }),
    BBB: fut({ nodeFuturesScore: 70, researchComposite: 0.42, agreement: 0.61, gaps: [] }),
  };
  const out = String(researchPythonMarkup(snapWithResearch({ futures })));
  const iBBB = out.indexOf('<b>BBB</b>');
  const iAAA = out.indexOf('<b>AAA</b>');
  assert.ok(iBBB > 0 && iAAA > 0);
  assert.ok(iBBB < iAAA, 'BBB (cu composite) trebuie înaintea lui AAA (fără)');
  assert.match(out, /1 din 2 perechi futures au composite/);
  assert.ok(out.includes(DASH), 'AAA are — pe composite/agreement');
});

test('gaps: câmpurile indisponibile apar în sumar, cu motiv', () => {
  const features = { X: feat({ gaps: ['gainFrom20dLow', 'risingLows', 'openInterestChange14d'] }) };
  const out = String(researchPythonMarkup(snapWithResearch({ features })));
  assert.ok(out.includes('gainFrom20dLow'));
  assert.ok(out.includes('Câmpuri documentate ca indisponibile'));
});

test('simbol ostil: escapat, nu randat ca HTML', () => {
  const features = { '<img src=x onerror=alert(1)>': feat() };
  const out = String(researchPythonMarkup(snapWithResearch({ features })));
  assert.ok(!out.includes('<img'), 'nu trebuie să existe element injectat');
  assert.ok(out.includes('&lt;img'));
});

test('markup nu are undefined / NaN / null / [object', () => {
  const features = { A: feat(), B: feat({ momentumComposite: null }) };
  const futures = { C: fut(), D: fut({ researchComposite: null, agreement: null }) };
  const out = String(researchPythonMarkup(snapWithResearch({ features, futures })));
  assert.ok(!leaks(out));
});

test('discovery: afișează research composite, fără node score și fără agreement', () => {
  const snap = {
    meta: { generatedAt: '2026-01-01T00:00:00Z' },
    candidates: [],
    research: {
      momentum: { features: {} },
      liquidity: {
        futures: {},
        discovery: {
          AAA: { researchComposite: 0.6, gaps: [] },
          BBB: { researchComposite: null, gaps: ['researchComposite'] },
        },
      },
    },
  };

  const out = String(researchPythonMarkup(snap));

  assert.ok(out.includes('Lichiditate discovery'));
  assert.ok(out.includes('<b>AAA</b>'));
  assert.ok(out.includes('0.600'));
  assert.ok(out.includes(DASH), 'BBB fără composite trebuie să apară ca —');
  assert.ok(!out.includes('<th>Node score</th>'), 'discovery nu are coloana Node score');
  assert.ok(!out.includes('<th>Agreement</th>'), 'discovery nu are coloana Agreement');
  assert.ok(!leaks(out));
});
