/**
 * FACTS — the radar's own measured data, as plain text for the assistant's `radar` tool. The same
 * answers the deterministic agent gives (domain/chat.js), so the assistant and the agent never disagree
 * about a number; the assistant may rephrase, but the numbers come from here.
 */
import { answerChanges, answerEfficiency, answerForecast, answerGates, answerLearning, answerRules, answerSignals, answerStatus } from '../domain/chat.js';
import { DEFAULT_TZ } from '../domain/plain.js';
import { decodeTable } from './observe.js';

const NEED = {
  memory: 'raportul agentului nu este disponibil în această rulare',
  state: 'starea cercetării nu este disponibilă în această rulare',
};

export async function radarTopic({ ports, cfg = {}, nowMs, topic, symbol = null, hours = 24 }) {
  const tz = cfg.chat?.timeZone ?? DEFAULT_TZ;
  const report = ports.memory ? await ports.memory.lastReport() : null;
  const memory = ports.memory ? await ports.memory.load() : null;
  if (['status', 'changes', 'gates', 'efficiency', 'rules', 'learning'].includes(topic) && !report) return { ok: false, text: NEED.memory };
  switch (topic) {
    case 'status': return { ok: true, text: answerStatus(report, { tz }) };
    case 'changes': return { ok: true, text: answerChanges(report, memory, { nowMs, hours, tz }) };
    case 'gates': return { ok: true, text: answerGates(report, { group: null, all: false, tz }) };
    case 'efficiency': return { ok: true, text: answerEfficiency(report, { why: false }) };
    case 'rules': return { ok: true, text: answerRules(report, { ruleId: null, all: false, tz }) };
    case 'learning': return { ok: true, text: answerLearning(report, { tz }) };
    case 'signals':
    case 'forecast': {
      if (!ports.state?.universe) return { ok: false, text: NEED.state };
      const [u, s] = await Promise.all([ports.state.universe(), ports.state.snapshot ? ports.state.snapshot() : null]);
      const rows = u?.ok ? decodeTable(u.data?.assets) : [];
      const forecast = s?.ok ? s.data?.forecast ?? null : null;
      return { ok: true, text: topic === 'signals' ? answerSignals(rows, { all: false }) : answerForecast(rows, forecast, symbol, { all: !symbol, why: true }) };
    }
    default:
      return { ok: false, text: `subiect necunoscut: ${topic}` };
  }
}
