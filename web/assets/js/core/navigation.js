/**
 * Navigation model of the dashboard: which sections exist, in which menu, in what order.
 * Pure data and functions — no DOM, no I/O — so the structure is checked in Node
 * (test/web/navigation.test.js) and a menu change never touches a view.
 *
 * Where it sits in the hexagon. data/latest.json is the contract; every view is a pure function
 * from that contract to markup; screens.js binds one view to each id declared here; main.js is the
 * composition root (router, drawer, tooltips, theme). The frontend renders research, it never
 * computes it, and it imports only from web/.
 *
 *   Level 1 — main sections: the tab bar right under the market-regime strip.
 *   Level 2 — the second menu, on one horizontal line: the working set first (the assistant and
 *             the radars), then, after a separator, the screens that support it.
 */

/** The landing section: what opens without a hash, and where the brand link goes. */
export const HOME = 'oportunitati';

export const SECTIONS = Object.freeze([
  // Level 1 — main sections.
  { id: 'oportunitati', label: 'Oportunități proiecte', level: 1 },

  // Level 2 — the second menu, working set. The order is the order a researcher works in.
  { id: 'asistent', label: 'AI Assistant', level: 2, group: 'work' },
  { id: 'radar-small-cap', label: 'Small-Cap Radar', level: 2, group: 'work' },
  { id: 'futures', label: 'Futures Radar', level: 2, group: 'work' },
  { id: 'deep-research', label: 'Deep Research', level: 2, group: 'work' },

  // Level 2 — the second menu, supporting screens.
  { id: 'univers', label: 'Univers', level: 2, group: 'support' },
  { id: 'validare', label: 'Validare', level: 2, group: 'support' },
  { id: 'prognoza', label: 'Prognoză ≥100×', level: 2, group: 'support' },
  { id: 'alerte', label: 'Alerte', level: 2, group: 'support' },
  { id: 'analogi', label: 'Analogi LAB/BTW/AGT', level: 2, group: 'support' },
  { id: 'radar', label: 'Radar CRI', level: 2, group: 'support' },
  { id: 'derivate', label: 'Derivate', level: 2, group: 'support' },
  { id: 'narative', label: 'Narative', level: 2, group: 'support' },
  { id: 'track-record', label: 'Track record', level: 2, group: 'support' },
  { id: 'paritate', label: 'Paritate și bugete', level: 2, group: 'support' },
  { id: 'agent', label: 'Agent AI', level: 2, group: 'support' },
  { id: 'surse', label: 'Date și surse', level: 2, group: 'support' },
  { id: 'metodologie', label: 'Metodologie', level: 2, group: 'support' },
].map((s) => Object.freeze(s)));

export const sectionById = (id) => SECTIONS.find((s) => s.id === id) ?? null;

/** Level 1: the main sections. */
export const mainSections = () => SECTIONS.filter((s) => s.level === 1);

/** Level 2: the second menu — one group ('work' | 'support'), or every entry when omitted. */
export const menuSections = (group) => SECTIONS.filter((s) => s.level === 2 && (!group || s.group === group));

/** `#/futures?t=ABC` → { id: 'futures', token: 'ABC' }. An empty or unknown hash lands on HOME. */
export function parseHash(hash = '') {
  const raw = String(hash).replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { id: sectionById(path) ? path : HOME, token: new URLSearchParams(query).get('t') };
}

/** The hash of a section; `token` is the project whose research card is open over it. */
export function hrefFor(id, token) {
  return `#/${id}${token ? `?t=${encodeURIComponent(token)}` : ''}`;
}
