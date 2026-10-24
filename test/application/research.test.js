import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowPersistence } from '../../src/application/use-cases/research.js';

test('accumulation persistence needs two observations and counts positive wallet flows', () => {
  assert.equal(flowPersistence(0.3, []), null, 'a single observation is not persistence');
  assert.deepEqual(flowPersistence(0.3, [{ walletNet: 0.2 }, { walletNet: -0.1 }, { walletNet: null }]), { positive: 2, total: 3, share: 0.667 });
  assert.equal(flowPersistence(null, [{ walletNet: 0.2 }, { walletNet: 0.4 }]).total, 2);
  const long = Array.from({ length: 12 }, () => ({ walletNet: 0.5 }));
  assert.equal(flowPersistence(0.5, long).total, 6, 'looks at the six most recent observations');
});
