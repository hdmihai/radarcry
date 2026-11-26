import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attachResearch } from '../src/application/use-cases/attach-research.js';

const snap = () => ({ schemaVersion: '4.0.0', meta: { generatedAt: 'x' }, market: {} });

describe('attachResearch', () => {
  it('returns snapshot unchanged when research is null', () => {
    const s = snap();
    assert.equal(attachResearch(s, null), s);
  });

  it('returns snapshot unchanged when both sections are null', () => {
    const s = snap();
    assert.equal(attachResearch(s, { momentum: null, liquidity: null }), s);
  });

  it('returns snapshot unchanged when research is empty object', () => {
    const s = snap();
    assert.equal(attachResearch(s, {}), s);
  });

  it('attaches momentum only when liquidity is absent', () => {
    const s = snap();
    const out = attachResearch(s, { momentum: { features: { BTC: { outperformance7d: 1 } } } });
    assert.deepEqual(out.research.momentum, { features: { BTC: { outperformance7d: 1 } } });
    assert.equal(out.research.liquidity, undefined);
  });

  it('attaches both sections when present', () => {
    const s = snap();
    const out = attachResearch(s, {
      momentum: { meta: { n: 1 }, features: {} },
      liquidity: { meta: { n: 1 }, discovery: {}, futures: {} },
    });
    assert.ok(out.research.momentum);
    assert.ok(out.research.liquidity);
  });

  it('does not mutate the input snapshot', () => {
    const s = snap();
    const before = JSON.stringify(s);
    attachResearch(s, { momentum: { features: {} } });
    assert.equal(JSON.stringify(s), before);
  });

  it('preserves all other top-level keys', () => {
    const s = snap();
    s.discovery = { rows: [] };
    s.futures = { rows: [] };
    const out = attachResearch(s, { liquidity: { discovery: {}, futures: {} } });
    assert.deepEqual(out.discovery, { rows: [] });
    assert.deepEqual(out.futures, { rows: [] });
  });
});
