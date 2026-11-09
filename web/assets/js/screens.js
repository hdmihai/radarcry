/**
 * Screens: the binding between the navigation model (core/navigation.js) and the views.
 *
 * Each section id gets `render` (snapshot → markup) and, where it applies, `count` (the number on
 * its tab) and `enter` (loads the screen's own data file or connection when it opens). This is the
 * only module that knows both sides, so the model never imports a view and a view never imports
 * the model. Pure: nothing here touches the DOM; main.js decides when to call what.
 */
import { agentMarkup, agentState, ensureAgent } from './views/agent.js';
import { analogsMarkup } from './views/analogs.js';
import { catalystsMarkup } from './views/catalysts.js';
import { chatMarkup, chatState, enterChat } from './views/chat.js';
import { discoveryMarkup } from './views/discovery.js';
import { forecastMarkup } from './views/forecast.js';
import { futuresMarkup } from './views/futures.js';
import { healthMarkup } from './views/health.js';
import { derivativesMarkup, narrativesMarkup } from './views/markets.js';
import { methodologyMarkup } from './views/methodology.js';
import { opportunitiesMarkup, strongSetups } from './views/opportunities.js';
import { parityMarkup } from './views/parity.js';
import { radarMarkup } from './views/radar.js';
import { researchMarkup } from './views/research.js';
import { trackMarkup } from './views/track.js';
import { ensureUniverse, universeMarkup } from './views/universe.js';
import { validityMarkup } from './views/validity.js';

export const SCREENS = {
  // Level 1 — the question, the setups that resemble LAB / BTW / AGT, and the opportunity map.
  oportunitati: { render: opportunitiesMarkup, count: strongSetups },

  // Level 2 — working set.
  // The AI assistant: plain-text chat with a saved history, hosted in a private GitHub repo.
  asistent: { render: chatMarkup, count: () => (chatState.status === 'online' ? chatState.convs.length : null), enter: () => enterChat() },
  'radar-small-cap': { render: discoveryMarkup, count: (s) => (s.discovery?.answering ?? 0) },
  futures: { render: futuresMarkup, count: (s) => (s.futures?.summary?.graded ?? 0) },
  'deep-research': { render: researchMarkup, count: (s) => (s.discovery?.rows ?? []).filter((r) => r.detail === 'full' || r.platforms?.length).length },

  // Level 2 — supporting screens.
  // The whole horizon, from data/universe.json — loaded only when this screen is opened.
  univers: { render: universeMarkup, count: (s) => s.meta?.universe?.projects ?? 0, enter: (s) => (s.meta?.universe ? ensureUniverse(s.meta.universe.file ?? 'data/universe.json') : Promise.resolve()) },
  // The gate in front of every CRI list: its rules, its counts, and every project it held back.
  validare: { render: validityMarkup, count: (s) => s.validity?.summary?.valid ?? 0 },
  // The ≥100× forecast for every verified project, and the learning list of the last year's winners.
  prognoza: { render: forecastMarkup, count: (s) => (s.forecast?.winners ?? []).filter((w) => w.status === 'CONFIRMED' || w.status === 'DOCUMENTED').length },
  alerte: { render: catalystsMarkup, count: (s) => (s.alerts?.items ?? []).length },
  analogi: { render: analogsMarkup, count: (s) => (s.references ?? []).length },
  radar: { render: radarMarkup, count: (s) => s.candidates.length },
  derivate: { render: derivativesMarkup, count: (s) => (s.derivatives?.squeezeWatch ?? []).length },
  narative: { render: narrativesMarkup },
  'track-record': { render: trackMarkup, count: (s) => (s.trackRecord?.recent ?? []).length },
  paritate: { render: parityMarkup },
  // The AI quality agent's report, from data/agent.json — loaded only when this screen is opened.
  agent: { render: agentMarkup, count: () => (agentState.status === 'ready' ? agentState.data.findings?.length ?? 0 : null), enter: () => ensureAgent('data/agent.json') },
  surse: { render: healthMarkup },
  metodologie: { render: methodologyMarkup },
};
