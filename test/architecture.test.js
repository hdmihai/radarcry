/**
 * Architecture fitness test: the hexagonal dependency rule is checked on every import.
 *   domain       → only domain
 *   application  → domain + application (+ node:crypto for deterministic hashing, no I/O)
 *   adapters     → anything inward (domain, application ports), never the composition root
 *   web          → only web (the frontend talks to the engine through data/latest.json only)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { ROOT } from './fixture-run.js';

async function jsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await jsFiles(p)));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

async function importsOf(file) {
  const src = await readFile(file, 'utf8');
  const specs = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm), ...src.matchAll(/^\s*export\s[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  return specs.map((s) => (s.startsWith('.') ? { spec: s, path: relative(ROOT, resolve(dirname(file), s)) } : { spec: s, path: null }));
}

const layer = (rel) => rel.split('/').slice(0, 2).join('/');

test('domain is pure: no I/O, no outward imports', async () => {
  for (const f of await jsFiles(join(ROOT, 'src/domain'))) {
    for (const i of await importsOf(f)) {
      assert.ok(i.path && i.path.startsWith('src/domain/'), `${relative(ROOT, f)} imports ${i.spec}`);
    }
  }
});

test('application depends only on the domain and its own ports', async () => {
  for (const f of await jsFiles(join(ROOT, 'src/application'))) {
    for (const i of await importsOf(f)) {
      if (!i.path) {
        assert.equal(i.spec, 'node:crypto', `${relative(ROOT, f)} imports ${i.spec}`);
        continue;
      }
      assert.ok(['src/domain', 'src/application'].includes(layer(i.path)), `${relative(ROOT, f)} imports ${i.spec}`);
    }
  }
});

test('adapters never import the composition root', async () => {
  for (const f of await jsFiles(join(ROOT, 'src/adapters'))) {
    for (const i of await importsOf(f)) assert.notEqual(i.path, 'src/main.js', `${relative(ROOT, f)} imports main.js`);
  }
});

test('frontend is self-contained: it only reads the published contract', async () => {
  for (const f of await jsFiles(join(ROOT, 'web'))) {
    for (const i of await importsOf(f)) {
      assert.ok(i.path && i.path.startsWith('web/'), `${relative(ROOT, f)} imports ${i.spec}`);
    }
  }
});

/**
 * APPROVED SOURCES — the fitness test that enforces the project's hardest constraint.
 *
 * The brief is explicit: public or free-account APIs only, no subscription of any kind. That is a
 * promise about which hosts the code may talk to, so it is checked mechanically rather than trusted.
 * Every absolute http(s) URL in the adapter layer must resolve to a host on this list. Adding a
 * provider therefore requires adding it here, in the same commit, with its plan stated — which is
 * exactly the review step that keeps a paid endpoint from sneaking in.
 */
const APPROVED_HOSTS = {
  // aggregators — free key or keyless
  'api.coingecko.com': 'CoinGecko Demo (cheie gratuită, 10 000 apeluri/lună)',
  'pro-api.coingecko.com': 'CoinGecko Pro host, folosit doar dacă operatorul are deja o cheie',
  'pro-api.coinmarketcap.com': 'CoinMarketCap Basic (cheie gratuită, 10 000 credite/lună)',
  'api.coinpaprika.com': 'CoinPaprika (public, fără cheie)',
  // exchanges — public market-data endpoints
  'api.mexc.com': 'MEXC spot (public)',
  'contract.mexc.com': 'MEXC futures (public)',
  'data-api.binance.vision': 'Binance public data mirror (public, fără cont)',
  'www.binance.com': 'Binance Alpha token list (endpoint public)',
  'api.gateio.ws': 'Gate perpetuals (public)',
  'api.bitget.com': 'Bitget perpetuals (public)',
  'www.okx.com': 'OKX perpetuals (public)',
  'api.hyperliquid.xyz': 'Hyperliquid info endpoint (public)',
  'api.upbit.com': 'Upbit markets (public)',
  'api.bithumb.com': 'Bithumb markets (public)',
  // derivatives aggregation — free account
  'api.coinalyze.net': 'Coinalyze (cont gratuit, 40 apeluri/minut)',
  // on-chain
  'api.dexscreener.com': 'DexScreener (public, fără cheie)',
  'api.geckoterminal.com': 'GeckoTerminal (public, fără cheie)',
  'api.gopluslabs.io': 'GoPlus Security (plan gratuit, 150k unități/lună)',
  'api.mainnet-beta.solana.com': 'Solana public RPC (fără cheie)',
  'api.llama.fi': 'DefiLlama Open API (fără cheie)',
  // sentiment, development, attention
  'api.alternative.me': 'alternative.me Fear & Greed (public)',
  'api.cryptoquant.com': 'CryptoQuant Basic (cheie gratuită, date de piață)',
  'api.github.com': 'GitHub REST (token gratuit)',
  'www.googleapis.com': 'YouTube Data API v3 (cheie gratuită, 10 000 unități/zi)',
  // optional free/trial key
  'api.arkm.com': 'Arkham Intel API (trial gratuit, opțional — nimic nu se rupe fără el)',
};

/** Documentation, signup and local-preview targets — never an outbound data source. */
const LINK_ONLY = new Set(['github.com', 'raw.githubusercontent.com', 'json-schema.org', 'cri-radar.local', 'localhost', 'local', '127.0.0.1']);

test('adapters only reach hosts on the approved free-source list', async () => {
  const seen = new Set();
  // Only the real outbound adapters reach the network: the inbound server is a local preview and
  // the fixture providers are an offline simulator whose URLs are placeholders inside the payload.
  for (const f of (await jsFiles(join(ROOT, 'src/adapters/outbound'))).filter((x) => !x.includes('/fixtures/'))) {
    const src = await readFile(f, 'utf8');
    for (const m of src.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      const host = m[1].toLowerCase();
      if (LINK_ONLY.has(host)) continue;
      // Hosts assembled from a template (NodeReal's per-chain hosts) are declared in their adapter.
      if (host.endsWith('.nodereal.io')) { seen.add('nodereal'); continue; }
      assert.ok(
        Object.prototype.hasOwnProperty.call(APPROVED_HOSTS, host),
        `${relative(ROOT, f)} apelează ${host}, care nu este pe lista de surse aprobate — adaugă-l în APPROVED_HOSTS cu planul gratuit pe care rulează, sau scoate apelul`,
      );
      seen.add(host);
    }
  }
  assert.ok(seen.size >= 15, `prea puține surse detectate (${seen.size}) — testul nu mai acoperă stratul de adaptoare`);
});

test('no adapter reaches a host known to require a subscription', async () => {
  // Endpoints deliberately excluded by the brief. CoinGlass, Dune and X stay in the project as free
  // web links (see src/domain/platforms/registry.js); their APIs must never be called from code.
  const PAID = [
    ['open-api.coinglass.com', 'CoinGlass API — plan plătit; platforma rămâne ca link web gratuit'],
    ['api.coinglass.com', 'CoinGlass API — plan plătit'],
    ['api.dune.com', 'Dune API — plan plătit; interfața web rămâne ca link gratuit'],
    ['api.twitter.com', 'X API — nu are nivel gratuit de citire'],
    ['api.x.com', 'X API — nu are nivel gratuit de citire'],
    ['deep-index.moralis.io', 'Moralis — plan plătit'],
    ['api.etherscan.io', 'Etherscan — cheile per-lanț necesare sunt plătite'],
    ['cryptopanic.com', 'CryptoPanic — planul Developer gratuit a fost retras'],
  ];
  for (const f of await jsFiles(join(ROOT, 'src'))) {
    const src = await readFile(f, 'utf8');
    for (const [host, why] of PAID) {
      const called = new RegExp(`https?://${host.replace(/\./g, '\\.')}`).test(src);
      assert.ok(!called, `${relative(ROOT, f)} apelează ${host} — ${why}`);
    }
  }
});

test('no adapter implements an order or withdrawal endpoint', async () => {
  // The project is research-only. A trading endpoint must not exist anywhere, not even unused.
  const FORBIDDEN = [/\/api\/v3\/order/i, /\/api\/v\d\/private\//i, /createOrder/i, /placeOrder/i, /\bwithdraw\b/i, /\/capital\/withdraw/i];
  for (const f of await jsFiles(join(ROOT, 'src'))) {
    const src = await readFile(f, 'utf8');
    for (const re of FORBIDDEN) {
      assert.ok(!re.test(src), `${relative(ROOT, f)} conține un endpoint de execuție (${re}) — proiectul este exclusiv de research`);
    }
  }
});

test('the domain is deterministic: no clock, no randomness', async () => {
  /*
   * Point-in-time research only works if a replay of the same inputs reproduces the same scores.
   * A single Date.now() inside the domain breaks that quietly — the code keeps working, but two
   * runs over identical data can disagree, and no test would notice. Time enters through ClockPort
   * at the composition root and travels inward as an explicit nowMs argument; randomness never
   * enters at all. Comments are stripped before the check so documentation may still name them.
   */
  const FORBIDDEN = [
    [/\bDate\.now\s*\(/, 'Date.now() — primește nowMs ca argument explicit'],
    [/\bMath\.random\s*\(/, 'Math.random() — domeniul trebuie să fie reproductibil'],
    [/\bnew\s+Date\s*\(\s*\)/, 'new Date() fără argument — citește ceasul'],
    [/\bperformance\.now\s*\(/, 'performance.now() — citește ceasul'],
  ];
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = await jsFiles(join(ROOT, 'src', 'domain'));
  assert.ok(files.length > 20, `prea puține fișiere de domeniu găsite (${files.length})`);
  for (const f of files) {
    const code = stripComments(await readFile(f, 'utf8'));
    for (const [re, why] of FORBIDDEN) {
      assert.ok(!re.test(code), `${relative(ROOT, f)} conține ${why}`);
    }
  }
});

test('the fixture adapters implement the same port surface as the live ones', async () => {
  /*
   * The demo, the 30-day simulation and most of the test suite run on the fixture providers. That
   * only proves anything about the real pipeline if both implementations offer the same surface:
   * a method that exists live but not in fixtures is a code path no test ever touches, and one that
   * exists only in fixtures is a test passing against something that is not there in production.
   *
   * Neither factory performs I/O at construction time, so both can be built here without a network.
   */
  const { createLiveProviders } = await import('../src/main.js');
  const { createFixtureProviders } = await import('../src/adapters/outbound/fixtures/fixture-providers.js');
  const { createDemoMarket } = await import('../src/adapters/outbound/fixtures/demo-market.js');
  const { loadConfig } = await import('../src/config/load-config.js');

  const endMs = Date.parse('2026-06-15T00:00:00Z');
  const clock = { now: () => endMs };
  const { config } = await loadConfig({ root: ROOT, cli: {} });
  const noopLogger = { info() {}, warn() {}, debug() {}, error() {} };
  const live = createLiveProviders({ config, keys: {}, telemetry: { record() {} }, logger: noopLogger, deadlineMs: endMs + 60_000 });
  const fixture = createFixtureProviders({ market: createDemoMarket({ endMs, days: 40, size: 40 }), clock });

  const liveKeys = Object.keys(live).sort();
  const fixtureKeys = Object.keys(fixture).sort();
  assert.deepEqual(fixtureKeys, liveKeys, 'fixture and live provider maps must hold the same providers');

  const methods = (o) => Object.keys(o ?? {}).filter((k) => typeof o[k] === 'function').sort();
  for (const key of liveKeys) {
    const missing = methods(live[key]).filter((m) => !methods(fixture[key]).includes(m));
    assert.deepEqual(missing, [], `fixture provider "${key}" nu implementează ${missing.join(', ')} — demo-ul ar ocoli o cale reală de cod`);
  }
});

test('workflows never share a concurrency group, and the pulse yields to a running scan', async () => {
  /*
   * Concurrency groups are repository-wide: a run that arrives with `cancel-in-progress: true`
   * cancels whatever is running in its group, from any workflow. When the 15-minute pulse shared a
   * group with the full scan, the :22 pulse cancelled every :17 scan still in progress — i.e. all of
   * them — and the research state could never grow. Each workflow now has its own group, and the
   * pulse checks for a running scan explicitly and steps aside.
   */
  const dir = join(ROOT, '.github', 'workflows');
  const groups = new Map();
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.yml'))) {
    const lines = (await readFile(join(dir, f), 'utf8')).split('\n');
    const start = lines.findIndex((l) => /^concurrency:\s*$/.test(l));
    if (start < 0) continue;
    const groupLine = lines.slice(start + 1).find((l) => /^\s+group:\s*\S/.test(l));
    assert.ok(groupLine, `${f}: blocul concurrency nu are group`);
    const group = groupLine.replace(/^\s+group:\s*/, '').replace(/\s+#.*$/, '').trim();
    assert.ok(!groups.has(group), `${f} și ${groups.get(group)} împart grupul de concurență „${group}” — unul l-ar putea anula pe celălalt`);
    groups.set(group, f);
  }
  assert.ok(groups.size >= 2, 'scan and pulse both declare their own group');
  const scan = await readFile(join(dir, 'scan-and-deploy.yml'), 'utf8');
  assert.match(scan, /cancel-in-progress:\s*false/, 'a scan is never cancelled halfway through a state update');
  const pulse = await readFile(join(dir, 'pulse.yml'), 'utf8');
  assert.match(pulse, /--workflow scan-and-deploy\.yml/, 'the pulse looks for a running scan before writing');
  assert.match(pulse, /actions:\s*read/, 'and has the permission to see it');
});
