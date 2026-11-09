/**
 * The dashboard's two menus, without a browser: the navigation model is pure data, the screens
 * module binds a view to every section, and the bars are pure functions to markup — so the shape
 * the owner asked for (main sections as tabs under the market regime, the second menu on one
 * horizontal line) is checked on every commit, not trusted.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ROOT, runFixtureDays } from '../fixture-run.js';
import { indexSnapshot } from '../../web/assets/js/core/store.js';
import { initLabels } from '../../web/assets/js/core/labels.js';
import { HOME, SECTIONS, hrefFor, mainSections, menuSections, parseHash, sectionById } from '../../web/assets/js/core/navigation.js';
import { SCREENS } from '../../web/assets/js/screens.js';
import { mainTabsMarkup, menuMarkup } from '../../web/assets/js/views/shell.js';
import { pickSetups, strongSetups } from '../../web/assets/js/views/opportunities.js';

let run;
let snap;
before(async () => {
  run = await runFixtureDays({ days: 3 });
  snap = indexSnapshot(JSON.parse(JSON.stringify(run.snapshots.at(-1))));
  initLabels(snap.methodology);
});
after(async () => run?.cleanup());

const ids = (list) => list.map((s) => s.id);

/** Every section the dashboard had before the two-level menu: none may disappear. */
const BEFORE = ['futures', 'radar-small-cap', 'asistent', 'deep-research', 'univers', 'validare', 'prognoza', 'alerte', 'analogi', 'radar', 'derivate', 'narative', 'track-record', 'paritate', 'agent', 'surse', 'metodologie'];

test('navigation model: the main section is a tab, the second menu opens with the assistant and the two radars', () => {
  assert.deepEqual(ids(mainSections()), ['oportunitati']);
  assert.equal(HOME, 'oportunitati');
  assert.equal(sectionById(HOME).label, 'Oportunități proiecte');
  assert.deepEqual(ids(menuSections('work')), ['asistent', 'radar-small-cap', 'futures', 'deep-research']);
  assert.deepEqual(menuSections('work').slice(0, 3).map((s) => s.label), ['AI Assistant', 'Small-Cap Radar', 'Futures Radar']);
  assert.deepEqual(ids(menuSections()), [...ids(menuSections('work')), ...ids(menuSections('support'))], 'the second menu is the working set, then the supporting screens');
});

test('navigation model: ids are unique and URL-safe, and every section that existed before is still reachable', () => {
  const all = ids(SECTIONS);
  assert.equal(new Set(all).size, all.length, 'duplicate section id');
  for (const id of all) assert.match(id, /^[a-z0-9-]+$/, `${id} is not usable in a hash`);
  for (const id of BEFORE) assert.ok(menuSections().some((s) => s.id === id), `${id} disappeared from the second menu`);
  assert.equal(all.length, BEFORE.length + 1, 'the only new section is the main one');
});

test('routing: hash and section round-trip; an empty or unknown hash lands on the main section; the drawer token survives', () => {
  assert.deepEqual(parseHash(''), { id: HOME, token: null });
  assert.deepEqual(parseHash('#/'), { id: HOME, token: null });
  assert.deepEqual(parseHash('#/nu-exista'), { id: HOME, token: null });
  assert.deepEqual(parseHash('#/futures'), { id: 'futures', token: null });
  assert.deepEqual(parseHash('#/radar'), { id: 'radar', token: null }, 'the old Radar CRI bookmark still opens Radar CRI');
  assert.deepEqual(parseHash(hrefFor('oportunitati', 'cg:abc/1')), { id: 'oportunitati', token: 'cg:abc/1' });
  assert.equal(hrefFor('futures'), '#/futures');
  for (const s of SECTIONS) assert.equal(parseHash(hrefFor(s.id)).id, s.id);
});

test('screens: every section has a screen and every screen a section, and each one renders from the contract', () => {
  assert.deepEqual(Object.keys(SCREENS).sort(), ids(SECTIONS).sort());
  for (const s of SECTIONS) {
    const screen = SCREENS[s.id];
    assert.equal(typeof screen.render, 'function', `${s.id} has no render`);
    const markup = String(screen.render(snap));
    assert.ok(markup.length > 50, `${s.id} rendered almost nothing`);
    for (const bad of ['undefined', 'NaN', '[object Object]']) assert.equal(markup.includes(bad), false, `${s.id} leaks "${bad}"`);
    const n = screen.count?.(snap);
    assert.ok(n === undefined || n === null || Number.isFinite(n), `${s.id} count is not a number`);
  }
});

test('the two bars: the active entry is marked, counts show only above zero, one rule separates the working set from the rest', () => {
  const item = (id, label, count = null) => ({ id, label, count });
  const main = String(mainTabsMarkup([item('oportunitati', 'Oportunități proiecte', 5)], 'oportunitati'));
  assert.match(main, /<a class="tab"[^>]*href="#\/oportunitati"[^>]*aria-current="page"/);
  assert.match(main, /<span class="count">5<\/span>/);
  assert.equal(String(mainTabsMarkup([item('oportunitati', 'Oportunități proiecte', 0)], 'futures')).includes('count'), false, 'a zero count stays hidden');
  assert.equal(String(mainTabsMarkup([item('oportunitati', 'Oportunități proiecte')], 'futures')).includes('aria-current'), false, 'only the current section is marked');

  const menu = String(menuMarkup({ work: [item('asistent', 'AI Assistant', 0), item('futures', 'Futures Radar', 7)], support: [item('univers', 'Univers', 833)] }, 'futures'));
  assert.equal((menu.match(/aria-current="page"/g) ?? []).length, 1);
  assert.equal((menu.match(/class="tab-sep"/g) ?? []).length, 1);
  assert.equal((menu.match(/data-primary="1"/g) ?? []).length, 2, 'the working set is the emphasised group');
  assert.ok(menu.indexOf('AI Assistant') < menu.indexOf('class="tab-sep"') && menu.indexOf('class="tab-sep"') < menu.indexOf('Univers'));
  assert.equal(String(menuMarkup({ work: [], support: [item('univers', 'Univers')] }, 'univers')).includes('tab-sep'), false, 'no rule without a group on each side');
});

test('the full second menu renders every entry once, on one line, in the model order', () => {
  const item = (s) => ({ id: s.id, label: s.label, count: SCREENS[s.id].count?.(snap) ?? null });
  const markup = String(menuMarkup({ work: menuSections('work').map(item), support: menuSections('support').map(item) }, 'radar-small-cap'));
  const hrefs = [...markup.matchAll(/href="#\/([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ids(menuSections()));
  assert.equal(markup.includes('<br'), false);
  for (const bad of ['undefined', 'NaN', '[object Object]']) assert.equal(markup.includes(bad), false);
});

test('"Oportunități proiecte" carries the question, the setups that resemble LAB / BTW / AGT and the opportunity map, in one frame', () => {
  const markup = String(SCREENS.oportunitati.render(snap));
  for (const needle of ['class="qlead"', 'Ce seamănă acum cu LAB, BTW sau AGT', 'Harta oportunităților', 'class="setup-list"']) assert.ok(markup.includes(needle), `missing ${needle}`);
  assert.equal(markup.includes('class="frame'), false, 'the router already wraps the screen in a frame');
  assert.equal(SCREENS.oportunitati.count(snap), strongSetups(snap));
  assert.ok(pickSetups(snap).length <= 8);
});

test('index.html: the bars sit right under the market regime and above the content, and the old hero band is gone', async () => {
  const page = await readFile(join(ROOT, 'web/index.html'), 'utf8');
  const at = (needle) => {
    const i = page.indexOf(needle);
    assert.ok(i > 0, `index.html lacks ${needle}`);
    return i;
  };
  assert.ok(at('id="market-strip"') < at('id="tabs"') && at('id="tabs"') < at('id="menu-anchor"') && at('id="menu-anchor"') < at('id="menu"') && at('id="menu"') < at('id="view"'));
  assert.equal(page.includes('id="hero"'), false);
  assert.equal(page.includes('tabs-anchor'), false);
  assert.ok(page.includes(`href="${hrefFor(HOME)}" aria-label="CRI Radar, pagina principală"`), 'the brand opens the main section');
});

test('every internal link in the frontend points at a section that exists', async () => {
  const files = [join(ROOT, 'web/index.html')];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  await walk(join(ROOT, 'web/assets/js'));
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    for (const m of src.matchAll(/href="#\/([a-z0-9-]+)/g)) assert.ok(sectionById(m[1]), `${relative(ROOT, f)} links to #/${m[1]}, which is not a section`);
  }
});
