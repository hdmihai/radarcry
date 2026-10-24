#!/usr/bin/env node
/**
 * Build config/labels/evm-labels.json from the eth-labels dataset.
 *
 * Why a build step and not a runtime call: holder classification must work on every run, including
 * when the network is unavailable, and a research tool should not depend on a third-party repo being
 * up at scan time. The dataset is MIT-licensed, so it is compacted here and committed to the repo;
 * the scan then reads a local file with zero network cost and zero rate limit.
 *
 * Source: https://github.com/dawsbot/eth-labels (MIT). The scraped accounts file carries one row per
 * labelled address, with a free-text label and the Etherscan "nameTag" where present.
 *
 *   node scripts/update-labels.js            # download and rebuild
 *   node scripts/update-labels.js --dry-run  # report what would change, write nothing
 *   node scripts/update-labels.js --input <file>   # build from an already-downloaded copy
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOLDER_CLASSES } from '../src/domain/onchain/labels.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'config', 'labels', 'evm-labels.json');
const LICENSE_OUT = join(ROOT, 'config', 'labels', 'LICENSE-eth-labels.txt');
const SOURCE = 'https://raw.githubusercontent.com/dawsbot/eth-labels/HEAD/data/json/accounts.json';

/**
 * Dataset rows have two useful fields: `label` is a category slug ("bitget", "mev-bot",
 * "proposer-fee-recipient") and `nameTag` is the human name Etherscan shows ("Bitget 2",
 * "0x: MultiSig 2"). Classification reads the slug; the name becomes the entity shown in the UI.
 *
 * Slugs that describe a *role in a transaction*, a crowd of ordinary users, or a dead contract are
 * dropped entirely. This matters: "proposer-fee-recipient" (2 437 rows) and "exchange"-adjacent
 * fee roles were previously landing in the exchange bucket and inflating the CEX share of supply
 * for every token, and "friend-tech-users" / "airdrop-hunter" (≈15 000 rows) are retail wallets
 * whose label adds nothing to a concentration figure.
 */
const IGNORE_SLUGS = new Set([
  'proposer-fee-recipient', 'contract-deployer', 'genesis-address', 'take-action', 'friend-tech-users',
  'airdrop-hunter', 'sybil-delegate', 'delegate', 'buidlguidl-builders', 'protocol-guild-member',
  'retropgf-recipient', 'gitcoin-grants', 'endaoment', 'nonprofit', 'charity', 'donate', 'crowdfunding',
  'old-contract', 'deprecated', 'website-down', 'v2', 'parity-bug', 'maker-vault-owner',
  'balancer-vested-shareholders', 'multisig-owner', 'ico-wallets', 'token-sale', 'polkastarter',
  'blockchain-cuties', 'etheremon', 'decentraland', 'xstocks', 'real-world-assets', 'pareto',
]);

/** Slugs mapped directly, because a pattern over the slug text would mis-file them. */
const SLUG_CLASS = {
  // centralised venues
  bitget: 'cex', deribit: 'cex', bilaxy: 'cex', exchange: 'cex', coinbase: 'cex', kraken: 'cex',
  bitfinex: 'cex', bithumb: 'cex', nexo: 'cex', 'celsius-network': 'cex', 'binance-charity': 'cex',
  // flagged
  blocked: 'flagged', 'phish-hack': 'flagged', heist: 'flagged', exploit: 'flagged', mixer: 'flagged',
  'tornado-cash': 'flagged', 'ofac-sanctions-lists': 'flagged', 'ofac-sanctioned': 'flagged', gambling: 'flagged',
  // automation
  'mev-bot': 'bot', 'mev-builder': 'bot', 'erc-4337-bundler': 'bot', paymaster: 'bot', pimlico: 'bot',
  stackup: 'bot', biconomy: 'bot', alchemy: 'bot',
  // staking / consensus
  mining: 'staking', validator: 'staking', 'validator-group': 'staking', staking: 'staking',
  'avs-operator': 'staking', eigenlayer: 'staking', symbiotic: 'staking', mellow: 'staking', lido: 'staking',
  // plumbing
  'token-contract': 'contract', 'bridged-token': 'contract', 'binance-pegged': 'contract',
  'proxy-contract': 'contract',
  // treasuries / orgs
  multisig: 'project', 'safe-formerly-gnosis-safe': 'project',
  fund: 'fund',
};

/** Generic entity names that carry no actor information on their own. */
const GENERIC_ENTITIES = new Set(['token', 'tokens', 'contract', 'contracts', 'other', 'misc', 'unknown', 'wallet', 'wallets', 'address', 'addresses', 'take action', 'blocked']);

/** Canonical burn sinks always win, whatever the dataset calls them. */
const BURN_ADDRESSES = [
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '0xdead000000000000000042069420694206942069',
];

/** Ordered: the first pattern that matches a row's text decides its class. */
const RULES = [
  [HOLDER_CLASSES.BURN, [/\bburn\b/i, /incinerator/i, /black ?hole/i]],
  [HOLDER_CLASSES.LOCK, [/vesting/i, /\btimelock\b/i, /time ?lock/i, /lockup/i, /unicrypt/i, /team\.?finance/i, /pinklock/i]],
  [HOLDER_CLASSES.LP, [/liquidity ?pool/i, /\blp\b/i, /uniswap/i, /sushiswap/i, /pancake/i, /curve/i, /balancer/i, /\bpair\b/i, /\bamm\b/i, /velodrome/i, /aerodrome/i, /trader ?joe/i, /quickswap/i]],
  [HOLDER_CLASSES.BRIDGE, [/bridge/i, /wormhole/i, /\bportal\b/i, /layerzero/i, /stargate/i, /\bhop\b/i, /celer/i, /synapse/i, /multichain/i, /anyswap/i, /across/i, /orbiter/i]],
  [HOLDER_CLASSES.STAKING, [/staking/i, /stake ?pool/i, /masterchef/i, /\bgauge\b/i, /rewards? (pool|distributor|contract)/i, /\blido\b/i, /rocket ?pool/i, /\bdeposit contract\b/i]],
  [HOLDER_CLASSES.CEX, [/binance/i, /coinbase/i, /kraken/i, /\bokx\b|okex/i, /bybit/i, /kucoin/i, /gate\.?io/i, /\bmexc\b/i, /bitget/i, /huobi|\bhtx\b/i, /upbit/i, /bithumb/i, /crypto\.com/i, /bitfinex/i, /gemini/i, /bitstamp/i, /poloniex/i, /bittrex/i, /\bexchange\b/i, /\bcex\b/i, /korbit/i, /coinone/i, /\bwazirx\b/i, /bitmart/i, /lbank/i, /whitebit/i, /coincheck/i, /bitflyer/i]],
  [HOLDER_CLASSES.FLAGGED, [/\bhack(er|ed)?\b/i, /exploit/i, /\bscam\b/i, /phish/i, /sanction/i, /tornado/i, /mixer/i, /ransom/i, /stolen/i, /\bfake\b/i, /rug ?pull/i, /\bofac\b/i, /\bdrainer\b/i]],
  [HOLDER_CLASSES.FUND, [/\bcapital\b/i, /ventures?/i, /\bfund\b/i, /\blabs\b/i, /partners/i, /asset management/i, /\barca\b/i, /jump (trading|crypto)/i, /wintermute/i, /alameda/i, /\bgsr\b/i, /\bdwf\b/i, /cumberland/i, /amber group/i, /\ba16z\b/i, /paradigm/i, /pantera/i, /polychain/i, /galaxy digital/i, /grayscale/i, /blackrock/i, /fidelity/i]],
  [HOLDER_CLASSES.PROJECT, [/treasury/i, /foundation/i, /\bteam\b/i, /\bdao\b/i, /multi ?sig/i, /ecosystem fund/i, /\breserve\b/i, /\bissuer\b/i, /\bgrants?\b/i, /community fund/i]],
  [HOLDER_CLASSES.BOT, [/\bmev\b/i, /\bbot\b/i, /arbitrage/i, /sandwich/i, /jaredfromsubway/i, /banana ?gun/i, /maestro/i, /\btrojan\b/i, /flashbots/i, /sniper/i]],
  [HOLDER_CLASSES.PROTOCOL, [/\brouter\b/i, /\bfactory\b/i, /\bproxy\b/i, /\bvault\b/i, /controller/i, /\boracle\b/i, /registry/i, /aggregator/i, /protocol/i, /\baave\b/i, /compound/i, /makerdao/i, /\bgmx\b/i, /\bdydx\b/i, /\b1inch\b/i, /paraswap/i, /\b0x\b ?protocol/i, /\bsafe\b/i, /ens\b/i]],
];

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};

/**
 * Classification order: the explicit slug map, then the patterns over the slug, then the patterns
 * over the human name. An unmatched row is skipped rather than guessed — the classifier's own
 * structural detection handles unlabelled addresses at scan time.
 */
function classify(slug, nameTag) {
  const s = String(slug ?? '').toLowerCase().trim();
  if (s && IGNORE_SLUGS.has(s)) return null;
  if (s && SLUG_CLASS[s]) return SLUG_CLASS[s];
  const slugText = s.replace(/-/g, ' ');
  for (const [cls, patterns] of RULES) {
    if (patterns.some((re) => re.test(slugText))) return cls;
  }
  const name = String(nameTag ?? '');
  if (!name) return null;
  for (const [cls, patterns] of RULES) {
    if (patterns.some((re) => re.test(name))) return cls;
  }
  return null;
}

/** "0x-protocol" → "0x Protocol"; used when a row has no human nameTag. */
function prettySlug(slug) {
  return String(slug ?? '')
    .split('-')
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/** The dataset's rows come in several shapes across chains; accept all of them. */
function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  const out = [];
  for (const v of Object.values(payload ?? {})) {
    if (Array.isArray(v)) out.push(...v);
    else if (v && typeof v === 'object') out.push(...rowsOf(v));
  }
  return out;
}

/**
 * Prefer the human name Etherscan shows; fall back to a prettified slug.
 *
 * The name is then collapsed to the *entity*, not the wallet: "Bitget 47", "Binance: Hot Wallet 12"
 * and "Kraken 3" all become "Bitget", "Binance" and "Kraken". A researcher needs to know that an
 * exchange holds 8 % of supply, not which of its 47 hot wallets does — and the collapse cuts tens of
 * thousands of near-duplicate strings out of the committed dataset.
 */
function entityOf(row) {
  const tag = row.nameTag ?? row.name_tag ?? row.name ?? null;
  let candidate = tag ? String(tag).trim() : prettySlug(row.label);
  if (!candidate) return null;
  candidate = candidate
    .replace(/\s*[:\-–]\s*(hot|cold|deposit|withdraw(al)?|custody|reserve|funding|staking|exchange)?\s*wallet\b.*$/i, '')
    .replace(/\s*[:\-–].*$/, '')
    .replace(/\s+\d+$/, '')
    .replace(/\s+(v\d+(\.\d+)?)$/i, '')
    .trim();
  if (!candidate) candidate = prettySlug(row.label);
  if (!candidate || GENERIC_ENTITIES.has(candidate.toLowerCase())) return null;
  return candidate.slice(0, 48);
}

async function main() {
  const inputPath = valueOf('--input');
  let text;
  if (inputPath) {
    if (!existsSync(inputPath)) throw new Error(`fișierul ${inputPath} nu există`);
    text = await readFile(inputPath, 'utf8');
    console.log(`Citit local: ${inputPath} (${(text.length / 1e6).toFixed(1)} MB)`);
  } else {
    console.log(`Descarc ${SOURCE} …`);
    const res = await fetch(SOURCE, { headers: { accept: 'application/json', 'user-agent': 'CRI-Radar/4.0 label-builder' } });
    if (!res.ok) throw new Error(`descărcare eșuată: HTTP ${res.status}`);
    text = await res.text();
    console.log(`Descărcat: ${(text.length / 1e6).toFixed(1)} MB`);
  }

  const payload = JSON.parse(text);
  const rows = rowsOf(payload);
  console.log(`Rânduri brute: ${rows.length.toLocaleString('ro-RO')}`);

  /** @type {Map<string, {address:string, class:string, entity:string|null}>} */
  const index = new Map();
  const counts = {};
  let skipped = 0;

  for (const row of rows) {
    const address = String(row.address ?? row.account ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) { skipped += 1; continue; }
    const entity = entityOf(row);
    const cls = classify(row.label, row.nameTag ?? row.name_tag ?? row.name);
    if (!cls) { skipped += 1; continue; }
    if (index.has(address)) continue;
    index.set(address, { address, class: cls, entity });
    counts[cls] = (counts[cls] ?? 0) + 1;
  }

  // Canonical burn sinks override whatever the dataset said about them.
  for (const a of BURN_ADDRESSES) {
    index.set(a, { address: a, class: HOLDER_CLASSES.BURN, entity: 'Burn address' });
  }
  counts[HOLDER_CLASSES.BURN] = [...index.values()].filter((r) => r.class === HOLDER_CLASSES.BURN).length;

  // Columnar encoding: the dataset is committed to the repo, so it is stored compactly.
  // classes[] and entities[] are dictionaries; each row is "<address without 0x><classIdx>:<entityIdx>".
  const sorted = [...index.values()].sort((a, b) => a.address.localeCompare(b.address));
  const classes = [...new Set(sorted.map((r) => r.class))];
  const classIdx = new Map(classes.map((c, i) => [c, i]));
  const entities = [];
  const entityIdx = new Map();
  const rowsOut = sorted.map((r) => {
    let ei = -1;
    if (r.entity) {
      if (!entityIdx.has(r.entity)) { entityIdx.set(r.entity, entities.length); entities.push(r.entity); }
      ei = entityIdx.get(r.entity);
    }
    return `${r.address.slice(2)}|${classIdx.get(r.class)}|${ei >= 0 ? ei : ''}`;
  });

  const out = {
    source: 'https://github.com/dawsbot/eth-labels',
    license: 'MIT',
    builtAt: new Date().toISOString(),
    rowsScanned: rows.length,
    skipped,
    counts: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])),
    format: 'columnar-v1',
    classes,
    entities,
    rows: rowsOut,
  };

  console.log('Clasificate:');
  for (const [k, v] of Object.entries(out.counts)) console.log(`  ${k.padEnd(10)} ${v.toLocaleString('ro-RO')}`);
  console.log(`Total index: ${out.rows.length.toLocaleString('ro-RO')} adrese (ignorate: ${skipped.toLocaleString('ro-RO')})`);

  if (has('--dry-run')) {
    console.log('--dry-run: nu scriu nimic.');
    return;
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(out)}\n`, 'utf8');
  await writeFile(LICENSE_OUT, LICENSE_TEXT, 'utf8');
  console.log(`Scris ${OUT}`);
}

const LICENSE_TEXT = `Setul de date de etichete din config/labels/evm-labels.json este derivat din
proiectul eth-labels (https://github.com/dawsbot/eth-labels), publicat sub licența MIT.

MIT License

Copyright (c) Dawson Botsford and eth-labels contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

main().catch((err) => {
  console.error(`Eroare: ${err.message}`);
  process.exitCode = 1;
});
