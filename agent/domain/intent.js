/**
 * PLAIN LANGUAGE — what the owner means when he writes in his own words.
 *
 * „cum stă radarul azi?”, „de ce a picat scanarea?”, „ce s-a schimbat de ieri?”, „ce șanse are
 * LAB?”, „ce proiecte semnalează radarul?”, „cât de bine prinde proiectele bune?”, „scrie un test
 * pentru pragul de lichiditate” — no command words, no prefix, with or without diacritics, Romanian
 * or English. The understanding is deterministic: weighted cues per intent, entities read from the
 * text (a run, a workflow, a gate, a rule, a project's symbol, a time window), and a confidence. It
 * needs no model, so it works the same in GitHub, on a phone and in Termux; when it is unsure and a
 * local model is available, the application asks the model to classify (and checks what the model
 * says against the same vocabulary).
 *
 * A conversation has a thread: „de ce?”, „cum repar?”, „detalii”, „și acum?” only make sense after
 * the previous message, so such a short reply takes its topic and its subject from the context (the
 * issue it is written in, or the previous line on the terminal).
 *
 * Writing code is the one intent that must be asked for explicitly: a verb of making and a thing of
 * code together („scrie un test…”, „adaugă o funcție…”, „fă un pull request…”). „Repară scanarea”
 * alone is a diagnosis, not a code change, and a follow-up never becomes code.
 *
 * Pure.
 */
import { ISSUE_MARKER } from './chat.js';
import { COMMANDS, fold, parseCommand, runIdOf } from './commands.js';

export const INTENTS = Object.freeze(['status', 'changes', 'gates', 'diagnose', 'efficiency', 'forecast', 'signals', 'rules', 'learning', 'run', 'code', 'help', 'greet', 'ask']);

/** Weighted cues per intent, matched on the folded text (lower case, no diacritics). */
const CUES = {
  status: [
    [/\bcum (sta|merge|e|este|arata|o duce|stam|merg)\b/, 2.5],
    [/\b(stare|starea|status|situati[ae]|rezumat(ul)?|overview|sanatate[a]?|health)\b/, 2],
    [/\b(ce mai face|totul (e )?(ok|bine|in regula)|e (totul )?ok|merge totul|functioneaza totul|ce ai gasit)\b/, 2.5],
    [/\b(how is|how are things|what'?s the status|any problems?)\b/, 2],
    [/\b(raport(ul)?|azi|acum)\b/, 0.5],
  ],
  changes: [
    [/\bce s-?a (mai )?(schimbat|modificat)\b|\bce (mai )?(e|este|s-a) nou\b|\bnoutat\w*|\bschimbar(i|ile|ilor)\b|\bce ai (mai )?facut\b|\bwhat (has )?changed\b|\bwhat'?s new\b/, 3],
    [/\bce s-?a (mai )?intamplat\b.*\b(azi|astazi|ieri|recent|noaptea|peste noapte|ultim\w*)\b/, 3],
    [/\b(de ieri|ieri|ultimele \d+|ultima (zi|ora|saptamana)|saptamana (asta|aceasta|trecuta)|peste noapte|azi|astazi|since yesterday|today|recent)\b/, 0.8],
  ],
  gates: [
    [/\b(port(i|ile|ilor)|poart(a|ii)|gate(s)?|verificar(i|ile|ilor)|checks?)\b/, 2],
    [/\bce (nu )?trece\b|\bce (a )?esuat\b|\bce e (rosu|galben)\b/, 1.5],
    [/\btoate\b/, 0.3],
  ],
  diagnose: [
    [/\bde ce\b/, 1.5],
    [/\b(eroare|erori|erorile|esu(at|ata|eaza|ez)|esec|picat|pica|cazut|crapa|crapat|blocat|rosu|galben|problem(a|e|ele)|defect|sar(e|ite|it)|lipses\w*|intarzi\w*|grav|urgent)\b/, 2],
    [/\bnu (se |s-a |s-au |a |au )?(mai )?(se )?(merge|mers|functio|ruleaz|rulat|porne|pornit|public|actualiz|incarc|apar|afis|raspun)\w*/, 2],
    [/\b(fail(ed|s|ing)?|error|broken|crash(ed)?|why|went wrong)\b/, 2],
    [/\b(diagnoz|cauza|ce s-a intamplat|ce are|ce nu e bine|ce nu merge)\w*/, 2],
    [/\b(repar|rezolv)\w*/, 1],
  ],
  efficiency: [
    [/\b(eficient|identific)\w*/, 2],
    [/\b(lift|recall|hit rate|precizi\w*|acurat\w*)\b/, 2],
    [/\b(prinde|gaseste|alege|nimereste|proiectele (bune|corecte|potrivite)|semnal(ele)? (bune|corecte))\b/, 1.5],
    [/\bbate\b.*\bpiat\w*|\bbeat(s)? the market\b/, 2],
    [/\bcat de (bine|des|precis)\b/, 1],
    [/\b(banda|benzile|timpuriu|nivel(ul|uri|urile)?)\b/, 0.8],
  ],
  forecast: [
    [/\b(prognoz|forecast|probabilit|sans[aei]|potential(ul)?|multiplic)\w*/, 2],
    [/\b\d+\s?x\b|\bx\s?\d+\b|\b\d+\s?ori\b/, 1.5],
    [/\b(va (creste|face|exploda|urca)|poate (creste|face|ajunge)|o sa (creasca|faca)|cat de sus|pump)\b/, 1.5],
    [/\b(cele mai mari|top|cei mai buni|candidati)\b/, 0.5],
  ],
  signals: [
    [/\b(ce|care) proiecte\b|\b(cel mai bun proiect|cele mai bune proiecte|best projects?)\b|\bproiecte(le)? (interesante|promitatoare|de urmarit|semnalate|noi)\b|\boportunitat\w*|\bce (semnaleaza|a gasit|gaseste) (radarul|el)\b|\bce semnaleaza\b|\b(ce|pe care) (sa )?(le )?urmaresc\b|\bde urmarit\b|\bwatchlist\b|\bcandidat\w*|\bce merita (cercetat|urmarit)\b|\bsemnal(e|ele)? (noi|active|de azi|actuale)\b|\bwhat (projects|signals)\b/, 2.5],
    [/\b(banda timpuriu|stadiul? (1|2)|stage ?(1|2)|verdict(ul)? (de business|strict)|candidat\w* (timpuri\w*|de research))\b/, 1],
  ],
  rules: [
    [/\b(regul|criteri|principi|prag)\w*/, 2],
    [/\b(rules?|thresholds?|criteria)\b/, 2],
  ],
  learning: [
    [/\b(invat|autoevalu|auto-evalu|auto evalu|lectii|memori)\w*/, 2],
    [/\b(skill|brier|learn(ing|ed)?|self-?eval\w*)\b/, 2],
    [/\b(ce stii|ce ai invatat|progres\w*|se descurca)\b/, 1.5],
    [/\b(anticip|predic|prezic)\w*/, 2],
  ],
  help: [
    [/\b(ajutor|help|comenzi(le)?)\b/, 3],
    [/\b(ce (poti|stii sa) face|cum (te folosesc|lucrez cu tine|vorbesc cu tine)|ce intrebari|cine esti|ce esti tu|what can you|who are you)\b/, 3],
  ],
  greet: [
    [/^(salut|buna|hello|hi|hey|servus|neata|buna ziua|buna seara)\b|^(ce (mai )?faci|esti acolo|ma auzi|esti activ)\b/, 1.5],
    [/\b(multumesc|mersi|merci|ms|thanks|thank you|super|perfect|bravo)\b/, 1.5],
    [/^(ok|okay|bine|clar|am inteles|inteleg|gata|in regula|da)[\s.!,]*$/, 1.5],
  ],
  // „Pornește o scanare”: the agent explains what it starts by itself and how to start one by hand.
  run: [[/^(te rog,? |poti sa |poti |vreau sa |ai putea sa |as vrea sa |hai,? |acum )?(porneste|porni|pornesti|ruleaza|rula|rulezi|lanseaza|lansa|declanseaza|declansa|reporneste|reporni|da drumul|run|start|trigger|rerun|re-run)\b/, 1]],
  ask: [
    [/\b(cum (se calculeaza|functioneaza|se face|se masoara|lucreaza|se decide)|ce (inseamna|este|e) (?!nou)|ce face |la ce (foloseste|serveste)|explica\w*|care e diferenta|what is|how does|explain)\b/, 2],
    [/\?/, 0.3],
  ],
};

/** A verb of making and a thing of code: only both together ask for code. */
const CODE_VERB = /\b(scrie|scrii|adauga|adaugi|implementeaz\w*|modific\w*|schimb\w*|repar\w*|refactor\w*|creeaz\w*|creaza|fa|faci|genereaz\w*|actualizeaz\w*|corecteaz\w*|write|add|implement|fix|create|change|update|refactor)\b/;
const CODE_THING = /\b(cod(ul)?|test(e|ul|ele)?|functi(e|a|ile)|fisier(ul|e)?|modul(ul)?|adaptor(ul)?|script(ul)?|endpoint|parametru(l)?|camp(ul)?|view(-ul)?|ecran(ul)?|componenta|clasa|metoda|pull request|pr|bug(ul)?|regex|schema|workflow(-ul)?|config(uratia)?|code|function|file|tests?)\b|\.(js|json|yml|css|html|md)\b/;
const PRIORITY = ['code', 'run', 'diagnose', 'changes', 'forecast', 'signals', 'rules', 'efficiency', 'learning', 'gates', 'status', 'help', 'greet', 'ask'];

/**
 * The short replies that only make sense after the previous message, whole (punctuation aside).
 * WHY asks for the cause or the fix, MORE for the full list; the others ask for the same answer again.
 */
const FOLLOW_UP = /^(si |dar |ok,? |bine,? |deci,? )?(de ce( (asa|e asa|asta|s-a intamplat|crezi|nu|oare))?|why|cum asa|adica|deci|si|si acum|si apoi|si mai departe|si altceva|si restul|ce fac( acum)?|ce pot face|ce e de facut|ce ajuta|ce recomanzi|ce propui|cum (repar|rezolv)( asta)?|cum se (repara|rezolva)|care e cauza|cauza|explica( mai (mult|bine|pe larg))?|detalii|mai (mult|multe|exact|pe larg)( detalii)?|da,? (detalii|mai mult)|toate|tot|restul|altceva|ce inseamna asta|ce vrei sa spui|and|and now|more|details)$/;
const MORE = /\b(detalii|mai (mult|multe|exact|pe larg)|toate|tot|restul|altceva|more|details)\b/;

/** Concepts a gate is known by in conversation (the catalogue's ids stay the reference). */
export const GATE_CUES = Object.freeze([
  ['scan.run', /\bscan(are|area|arii|ari|arile|arilor|ul|ului)?\b|\bscan\b/],
  ['ci.run', /\b(ci|build(ul)?|integrare continua)\b|\bteste(le)?\b/],
  ['cad.scan', /\b(cadent\w*|programar\w*|cron|sar(e|ite|it) )\b.*\bscan|\bscan\w*.*\b(cadent\w*|programar\w*|sar(e|ite|it))\b/],
  ['cad.pulse', /\bpuls(ul|ului|uri|urile|urilor)?\b|\bpulse\b/],
  ['scan.providers', /\b(furnizor\w*|provider\w*|surse(le)? gratuite|solana|goplus|geckoterminal)\b/],
  ['scan.quota', /\b(cot(a|e|ele)|buget\w*|quota|limita lunara)\b/],
  ['scan.validity', /\b(validitat\w*|respins\w*|poarta de validitate)\b/],
  ['scan.forecast', /\bprognoz\w*/],
  ['scan.pages', /\b(site(-ul)?|pages|dashboard(-ul)?|pagina)\b/],
  ['scan.freshness', /\b(prospet\w*|vechi|neactualizat\w*|date(le)? vechi)\b/],
  ['scan.secrets', /\b(chei|cheie|cheile|secret\w*|token)\b/],
  ['scan.state', /\b(cri-state|starea cercetarii|ramura de stare)\b/],
  ['scan.duration', /\b(durat\w*|dureaza|prea (lent|mult))\b/],
  ['scan.universe', /\buniver\w*/],
  ['scan.contract', /\b(contract(ul)?|schem\w*)\b/],
  ['cad.active', /\b(dezactivat\w*|workflow(-uri)? (oprit|inactiv)\w*)\b/],
  ['cad.inactivity', /\binactivitat\w*/],
  ['per.probe', /\bsond(a|ei|e)\b|\bprobe\b/],
  ['per.labels', /\beticheta?e?(le)?\b|\blabels?\b/],
  ['model.calibration', /\bcalibr\w*/],
  ['model.trackrecord', /\btrack ?record\b|\bsemnal(e|ele)? (la scadenta|vechi)/],
  ['model.identification', /\bidentific\w*/],
  ['agent.memory', /\bmemori\w*/],
  ['agent.narrator', /\b(narat\w*|rezumat(ul)? (ai|agentului)|ollama|model(ul)? (local|de limbaj))\b/],
  ['agent.rules', /\breguli(le)?\b/],
  ['agent.learning', /\b(auto-?evalu\w*|autoevalu\w*)\b/],
  ['ci.arch', /\b(arhitectur\w*|hexagon\w*)\b/],
  ['ci.syntax', /\bsintax\w*/],
  ['ci.free', /\b(abonament\w*|surse gratuite|hosturi aprobate)\b/],
  ['ci.research', /\b(endpoint(uri)? de (ordine|tranzactionare)|retrager\w*)\b/],
]);

/** Which workflow a message talks about. */
const WORKFLOW_CUES = [
  ['scan', /\bscan(are|area|arii|ari|arile|arilor|ul|ului)?\b|\bscan\b/],
  ['pulse', /\bpuls(ul|ului|uri|urile|urilor)?\b|\bpulse\b/],
  ['probe', /\bsond(a|ei|e)\b|\bprobe\b/],
  ['labels', /\beticheta?e?(le)?\b|\blabels?\b/],
  ['ci', /\b(ci|build(ul)?)\b|\bteste(le)?\b/],
];

/** Words written in capitals that are language, not a ticker. */
const WORDS = new Set(['CE', 'CA', 'SI', 'DE', 'LA', 'IN', 'PE', 'CU', 'AI', 'UN', 'O', 'E', 'A', 'AM', 'AU', 'ARE', 'ESTE', 'CUM', 'CAT', 'CARE', 'MAI', 'SAU', 'DAR', 'NU', 'DA', 'OK', 'TOP', 'TOATE', 'AZI', 'ACUM', 'IERI', 'THE', 'AND', 'FOR', 'IS', 'IT', 'OF', 'TO', 'ON', 'DO', 'HOW', 'WHAT', 'WHY', 'ANY', 'X', 'P', 'TE', 'ROG', 'MI', 'SA', 'II', 'IL', 'LE', 'NE', 'VA', 'EU', 'TU', 'EL', 'EA', 'NOI', 'VOI', 'ORI', 'SUS', 'JOS', 'BUN', 'NOU', 'TOT']);
/** The project's own vocabulary in capitals: workflows, rules, formats. */
const PROJECT_WORDS = new Set(['CI', 'PR', 'API', 'URL', 'UTC', 'ID', 'FC', 'MON', 'SCAN', 'CRI', 'LLM', 'AGENT', 'RADAR', 'DEMO', 'JSON', 'HTML', 'JS', 'ERC', 'EARLY', 'STAGE', 'README', 'TERMUX', 'GITHUB']);
/** Never the small project a question means: language, the project's vocabulary, the market's giants. */
const NOT_SYMBOLS = new Set([...WORDS, ...PROJECT_WORDS, 'USD', 'BTC', 'ETH', 'BSC', 'SOL', 'AI']);

/**
 * A project's symbol in the message: written in capitals or as $SYM, or a known symbol in lower
 * case when the sentence is about a project („ce șanse are lab?”) — so „aia” or „bun” in an ordinary
 * sentence never become tickers.
 * @param {string} text
 * @param {Set<string>|null} [symbols]  the universe's symbols, when known
 * @param {{lower?:boolean}} [o]
 */
export function symbolIn(text, symbols = null, { lower = true } = {}) {
  const raw = String(text ?? '');
  const known = symbols instanceof Set ? symbols : null;
  const dollar = /\$([A-Za-z][A-Za-z0-9]{1,11})(?![\p{L}\p{N}])/u.exec(raw);
  if (dollar) return dollar[1].toUpperCase();
  // Whole words only: „FĂCUT” holds no „CUT”.
  const words = raw.match(/(?<![\p{L}\p{N}])[A-Za-z][A-Za-z0-9]{1,11}(?![\p{L}\p{N}])/gu) ?? [];
  // Capitals first: „ce șanse are LAB?” (in a message written all in capitals, only a known symbol).
  const loud = shouting(raw);
  for (const w of words) {
    const up = w.toUpperCase();
    if (w === up && /[A-Z]/.test(w) && w.length >= 2 && !NOT_SYMBOLS.has(up) && (known ? known.has(up) : !loud)) return up;
  }
  // A known symbol written in lower case (three letters at least, never a common word).
  if (known && lower) {
    for (const w of words) {
      const up = w.toUpperCase();
      if (w.length >= 3 && !NOT_SYMBOLS.has(up) && known.has(up) && !COMMON.has(fold(w))) return up;
    }
  }
  return null;
}

/** A message written (almost) all in capitals: its words are not tickers. */
const shouting = (raw) => {
  const letters = raw.match(/\p{L}/gu) ?? [];
  return raw.trim().split(/\s+/).length >= 3 && letters.length >= 8 && letters.filter((c) => c !== c.toLowerCase()).length / letters.length >= 0.7;
};

/** A word in capitals the radar does not know — „ce șanse are XYZ?” deserves „XYZ nu este în univers”. */
export function unknownSymbolIn(text, symbols = null) {
  if (shouting(String(text ?? '')) && !/\$[A-Za-z]/.test(String(text ?? ''))) return null;
  const words = String(text ?? '').match(/(?<![\p{L}\p{N}$])\$?[A-Z][A-Z0-9]{1,11}(?![\p{L}\p{N}])/gu) ?? [];
  const w = words.map((x) => x.replace(/^\$/, '')).find((x) => !WORDS.has(x) && !PROJECT_WORDS.has(x) && !(symbols instanceof Set && symbols.has(x)));
  return w ?? null;
}

/** Common Romanian and English words that also happen to be tickers somewhere. */
const COMMON = new Set(['are', 'care', 'cum', 'pentru', 'acum', 'bine', 'mult', 'sus', 'jos', 'nou', 'noi', 'tot', 'toate', 'face', 'bank', 'burn', 'eat', 'hype', 'coco', 'tag', 'john', 'share', 'pearl', 'cards', 'temple', 'rail', 'neet', 'gold', 'moon', 'sun', 'one', 'zero', 'max', 'mini', 'scan', 'test', 'code', 'data', 'time', 'life', 'love', 'real', 'meta', 'open', 'next', 'core', 'base', 'link', 'gas', 'fun', 'pump', 'dog', 'cat', 'ape', 'king', 'cash', 'pay', 'run', 'win', 'top', 'now', 'pro', 'agent', 'radar', 'lift', 'skill', 'cod', 'risc', 'stage', 'azi', 'ieri', 'deci', 'adica', 'restul', 'detalii']);

/** Gate ids the message names, best first (explicit ids, then concepts). */
export function gatesIn(text, catalogue = []) {
  const raw = String(text ?? '');
  const f = fold(raw);
  const ids = new Set((catalogue ?? []).map((g) => g.id));
  const out = [];
  for (const m of raw.matchAll(/\b([a-z]+\.[a-z]+(?:\.[a-z]+)?)\b/g)) if (!ids.size || ids.has(m[1])) out.push(m[1]);
  for (const [id, re] of GATE_CUES) if (re.test(f) && !out.includes(id) && (!ids.size || ids.has(id))) out.push(id);
  return out;
}

/**
 * The time window a message names: „de ieri” and „azi” are the last 24 hours, „săptămâna asta” the
 * last 7 days, „ultimele 6 ore” six hours. Without one, 24 hours.
 * @returns {{hours:number, named:boolean}}
 */
export function windowOf(text) {
  const f = fold(text);
  const m = /\bultimel?e?\s+(\d{1,3})\s+(de\s+)?(ore|ora|h|zile|zi)\b/.exec(f) ?? /\b(?:last|past)\s+(\d{1,3})\s+()(hours?|days?)\b/.exec(f);
  if (m) return { hours: Math.min(Number(m[1]) * (/^(z|d)/.test(m[3]) ? 24 : 1), 24 * 90) || 24, named: true };
  if (/\b(ultima ora|last hour)\b/.test(f)) return { hours: 1, named: true };
  if (/\b(saptaman\w*|7 zile|week)\b/.test(f)) return { hours: 168, named: true };
  if (/\b(luna (asta|aceasta|trecuta)|ultima luna|30 de zile|month)\b/.test(f)) return { hours: 720, named: true };
  if (/\b(azi|astazi|ieri|de ieri|peste noapte|noaptea|today|yesterday|24)\b/.test(f)) return { hours: 24, named: true };
  return { hours: 24, named: false };
}

const score = (f, cues) => cues.reduce((s, [re, w]) => (re.test(f) ? s + w : s), 0);
const bareOf = (text) => fold(String(text ?? '').replace(/^\s*\/agent\b:?/im, '')).trim().replace(/[?!.…]+$/g, '').replace(/\s+/g, ' ').trim();

/** A short reply that only makes sense after the previous message („de ce?”, „detalii”, „cum repar?”). */
export const isFollowUp = (text) => FOLLOW_UP.test(bareOf(text));

/**
 * What a follow-up continues in a GitHub thread: the owner's latest earlier message that is not itself
 * a follow-up (a second „de ce?” still means the question before), else the issue's title and first
 * message.
 * @param {string[]} previous  the owner's earlier messages in the thread, oldest first
 * @param {string|null} [issue]
 * @returns {string|null}
 */
export function threadContext(previous = [], issue = null) {
  for (let i = (previous ?? []).length - 1; i >= 0; i -= 1) {
    const m = String(previous[i] ?? '').replace(/^\s*\/agent\b:?/im, '').trim();
    if (m && !isFollowUp(m)) return m.slice(0, 6000);
  }
  const t = String(issue ?? '').trim();
  return t ? t.slice(0, 6000) : null;
}
const hasOwn = (e) => Boolean(e.runId || e.ruleId || e.symbol || e.workflow || e.gates.length);

/**
 * What a message asks for.
 * @param {string} text
 * @param {{symbols?:Set<string>, catalogue?:{id:string}[], requirePrefix?:boolean, commandWords?:boolean, context?:string|null}} [ctx]
 * @returns {{intent:string, confidence:number, explicit:boolean, ok:boolean, llm:boolean, coder:boolean,
 *            entities:{runId:number|null, workflow:string|null, gates:string[], ruleId:string|null, symbol:string|null, group:string|null, all:boolean},
 *            text:string, args:string, scores:Record<string,number>, followUp:boolean, topic:string|null, orphan?:boolean, reason:string|null}}
 */
export function understand(text, ctx = {}) {
  const parsed = parseCommand(text, { requirePrefix: Boolean(ctx.requirePrefix) });
  const hasPrefix = /^\s*\/agent\b/im.test(String(text ?? ''));
  let message = String(text ?? '').replace(/\r\n?/g, '\n').replace(/^\s*\/agent\b:?/im, '').trim();
  const base = { explicit: false, ok: true, followUp: false, topic: null, scores: {} };
  if (!parsed.ok) return { ...base, intent: 'none', confidence: 0, ok: false, llm: false, coder: false, entities: extractEntities(message, ctx), text: message, args: '', reason: parsed.reason };
  // „Întreabă …” / „Întrebare: …” only introduces the question: the rest is understood like any message.
  if (parsed.word && parsed.id === 'ask') message = parsed.args;
  // After /agent a short command word decides („/agent stare”, „/agent prognoză LAB”). Without the
  // prefix only „cod” does, and only on the terminal: in a conversation „cod de eroare la scanare”
  // is not an order to write code. Everywhere else a command word is a strong hint, so
  // „ajutor, nu merge site-ul” is a call for help with the site, not a request for the help text.
  const decides = parsed.word && parsed.id !== 'ask' && (hasPrefix || (parsed.id === 'code' && ctx.commandWords !== false)) && (parsed.id !== 'help' || !parsed.args);
  if (decides) {
    const c = COMMANDS.find((x) => x.id === parsed.id);
    const args = parsed.args;
    const entities = mergeEntities(extractEntities(message, ctx), extractEntities(args, ctx));
    return { ...base, intent: parsed.id, confidence: 1, explicit: true, llm: Boolean(c?.llm), coder: Boolean(c?.coder), entities, text: message, args, reason: `cuvânt de comandă „${parsed.word}”` };
  }
  const hint = parsed.word && !['ask', 'code'].includes(parsed.id) ? parsed.id : null;
  const entities = extractEntities(message, ctx);
  if (!message) return { ...base, intent: 'help', confidence: 1, llm: false, coder: false, entities, text: '', args: '', reason: 'mesaj gol' };

  const f = fold(message);
  // „De ce?”, „cum repar?”, „detalii”: the topic and the subject come from the previous message.
  const bare = bareOf(message);
  if (FOLLOW_UP.test(bare) && !hasOwn(entities)) {
    const fu = ctx.context ? followUp(message, bare, ctx) : null;
    if (fu) return fu;
    // „De ce?” with nothing before it: say what it would continue, never guess a topic.
    return { ...base, intent: 'help', confidence: 0.6, llm: false, coder: false, entities, text: message, args: message, orphan: true, reason: 'o continuare fără un mesaj anterior' };
  }

  const scores = Object.fromEntries(Object.entries(CUES).map(([k, cues]) => [k, score(f, cues)]));
  // Code: only a verb of making together with a thing of code.
  scores.code = CODE_VERB.test(f) && CODE_THING.test(f) ? 3 + (/\b(pull request|pr|scrie cod|write code)\b/.test(f) ? 2 : 0) : 0;
  // A command word the message starts with („porți …”, „reguli …”) points the way.
  if (hint) scores[hint] += 2;
  // Entities make an intent concrete.
  if (entities.symbol) scores.forecast += scores.forecast > 0 ? 2 : 1;
  if (entities.runId) scores.diagnose += 3;
  if (entities.ruleId) scores.rules += 3;
  if (entities.group) scores.gates += 1;
  // „de ce” about a failure is a diagnosis; „de ce” about a concept is an explanation.
  const failure = /\b(esu|picat|pica|cazut|eroare|erori|nu (se |s-a |s-au |a |au )?(mai )?(se )?(merge|mers|functio|ruleaz|rulat|porne|pornit|public|actualiz|incarc|apar|afis|raspun)|rosu|galben|fail|broken|atentionar\w*|warn|sar(e|ite|it)\b|lipses|intarzi)\w*/.test(f);
  if (/\bde ce\b/.test(f) && !failure) {
    scores.ask += 2.5;
    scores.diagnose -= 1.5;
  }
  if (failure && (entities.workflow || entities.gates.length)) scores.diagnose += 1.5;
  // „Repară scanarea” names something broken: a diagnosis (code needs a thing of code, above).
  if (/\b(repar|rezolv|fix)\w*/.test(f) && (entities.workflow || entities.gates.length) && !scores.code) scores.diagnose += 1.5;
  // „Pornește scanarea” names what to start; „când a fost ultima scanare?” asks about its runs.
  const named = Boolean(entities.workflow || entities.gates.length);
  if (scores.run && entities.workflow && !failure) scores.run += 2.5;
  else scores.run = 0;
  if (named && /\b(cand|ultima|ultimul|ultimele)\b/.test(f)) scores.diagnose += 1.5;
  // „Ce s-a întâmplat cu scanarea?” asks about the scan, not about everything that changed.
  if ((entities.workflow || entities.gates.length) && /\bintamplat\b/.test(f)) scores.changes = Math.min(scores.changes, 1);
  // „Ce înseamnă…”, „explică…”, „cum funcționează…” ask for an explanation, whatever the topic.
  if (/\b(cum (se calculeaza|functioneaza|se face|se masoara|lucreaza|se decide)|ce (inseamna|este|e) (?!nou)|la ce (foloseste|serveste)|explica\w*|care e diferenta|what is|how does|explain)\b/.test(f) && !failure) scores.ask += 1.5;
  // An explanation of how a forecast is made is not a forecast for a project.
  if (scores.ask >= 2 && !entities.symbol) scores.forecast = Math.max(0, scores.forecast - 2);
  // Greetings only count in short messages; „ajutor” with a failure asks for help with the failure.
  const words = message.split(/\s+/).length;
  if (words > 6) scores.greet = 0;
  if (failure && words > 3) scores.help = 0;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1] || PRIORITY.indexOf(a[0]) - PRIORITY.indexOf(b[0]));
  const [top, second] = ranked;
  let intent = top[1] >= 1.5 ? top[0] : 'ask';
  const confidence = top[1] >= 1.5 ? Math.round((top[1] / (top[1] + (second?.[1] ?? 0) + 0.5)) * 100) / 100 : 0.2;
  // A question that names only a project is about its forecast; one that names only a workflow or a
  // gate („și pulsul?”, „scanarea?”), or one gate („poarta de validitate?”), is about its state.
  if (intent === 'ask' && entities.symbol && scores.ask < 2) intent = 'forecast';
  else if (intent === 'ask' && words <= 4 && scores.ask < 2 && (entities.workflow || entities.gates.length || entities.runId)) intent = 'diagnose';
  else if (intent === 'gates' && /\bpoarta\b/.test(f) && entities.gates.length && !entities.group) intent = 'diagnose';
  // „Cum stă scanarea?” asks about the scan, „cum stă LAB?” about a project; „cum stă radarul?” about everything.
  else if (intent === 'status' && entities.symbol && !named) intent = 'forecast';
  else if (intent === 'status' && named && !/\b(radar(ul)?|proiect(ul)?|totul|tot)\b/.test(f)) intent = 'diagnose';
  return {
    ...base,
    intent,
    confidence,
    llm: intent === 'ask' || intent === 'code',
    coder: intent === 'code',
    entities,
    text: message,
    args: message,
    scores,
    reason: intent === 'ask' && top[1] < 1.5 ? 'nicio intenție clară: întrebare liberă' : `indicii pentru „${intent}”`,
  };
}

/** A short follow-up, read in the thread's context. */
function followUp(message, bare, ctx) {
  const context = String(ctx.context ?? '').slice(0, 6000);
  // The agent's own findings issue: the thread is about the findings.
  const findings = context.includes(ISSUE_MARKER);
  const prev = findings ? null : understand(context, { ...ctx, context: null, requirePrefix: false, commandWords: false });
  const topic = findings ? 'diagnose' : prev?.ok ? prev.intent : null;
  if (!topic || ['help', 'greet', 'none'].includes(topic)) return null;
  const more = MORE.test(bare);
  // „De ce?”, „cum așa?”, „adică?”: the reasons behind the previous answer.
  const why = !more && /\b(de ce|why|cauza|cum asa|adica|ce inseamna asta|ce vrei sa spui|explica)\b/.test(bare);
  const ent = { ...(prev?.entities ?? extractEntities('', ctx)), all: more || Boolean(prev?.entities?.all) };
  let intent = topic;
  let args = prev?.args ?? '';
  if (topic === 'ask' || topic === 'code') {
    // An explanation goes on with the same question; a follow-up never writes code.
    intent = 'ask';
    args = `${prev?.text ?? ''} — ${message}`.trim();
  } else if (['status', 'gates', 'diagnose', 'changes'].includes(topic)) {
    // About the radar's state, „de ce?” asks for the causes; „toate”/„detalii” for the full list.
    intent = more && (topic === 'status' || topic === 'gates') ? 'gates' : more && topic === 'changes' ? 'changes' : 'diagnose';
  }
  return {
    intent,
    confidence: 0.75,
    explicit: false,
    ok: true,
    llm: intent === 'ask',
    coder: false,
    entities: ent,
    text: message,
    args,
    scores: {},
    followUp: true,
    why,
    topic,
    reason: findings ? 'continuarea problemei cu porțile care cer atenție' : `continuarea mesajului anterior („${topic}”)`,
  };
}

/** A sentence about a project, where a known symbol may be written in lower case. */
const ABOUT_A_PROJECT = /\b(prognoz|forecast|probabilit|sans[aei]|potential|multiplic|merit|parere|despre|costa|pret|scam|risc|valid|proiect|token|moned|cum sta|cum e)\w*/;

/** Two readings of the same message: what the second names wins, what it lacks the first keeps. */
function mergeEntities(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (Array.isArray(v) ? v.length : v) out[k] = Array.isArray(v) ? [...new Set([...v, ...(a[k] ?? [])])] : v;
  return out;
}

const GROUP_WORD = { cod: 'cod', rulare: 'rulare', rularii: 'rulare', cadenta: 'cadenta', cadentei: 'cadenta', periodic: 'periodic', periodice: 'periodic', model: 'model', modelului: 'model', agent: 'agent', agentului: 'agent' };

function extractEntities(message, ctx = {}) {
  const f = fold(message);
  const rule = /\b(p|id|fc|mon)\s?-\s?(\d{1,2})\b/i.exec(message);
  // „porțile de cadență”, „grupul model”, „porți agent”, or the group's name alone.
  const gw = /\b(?:grup(?:ul)?|port(?:i|ile)|gates?)\s+(?:de\s+|din\s+|ale\s+)?(cod|rularii|rulare|cadentei|cadenta|periodice|periodic|modelului|model|agentului|agent)\b/.exec(f)?.[1] ?? /^(cod|rulare|cadenta|periodic|model|agent)$/.exec(f.trim())?.[1] ?? null;
  const group = gw ? GROUP_WORD[gw] : null;
  // A run: its URL, „run 123…”, „rularea 123…”, or a number as long as GitHub's run ids.
  const url = /\/actions\/runs\/(\d+)/.exec(message);
  const word = /\b(?:run(?:ul)?|rular(?:ea|e|ii)|job(?:ul)?)\s*(?:nr\.?\s*|numarul\s*|#)?(\d{6,})\b/.exec(f);
  const long = /(?<![\d.,])(\d{9,})(?![\d.,])/.exec(message);
  return {
    runId: runIdOf(message) ?? (url ? Number(url[1]) : word ? Number(word[1]) : long ? Number(long[1]) : null),
    workflow: WORKFLOW_CUES.find(([, re]) => re.test(f))?.[0] ?? null,
    gates: gatesIn(message, ctx.catalogue),
    ruleId: rule ? `${rule[1].toUpperCase()}-${Number(rule[2])}` : null,
    symbol: symbolIn(message, ctx.symbols, { lower: ABOUT_A_PROJECT.test(f) }),
    unknownSymbol: unknownSymbolIn(message, ctx.symbols),
    group,
    all: /\b(toate|tot|all|complet\w*)\b/.test(f),
  };
}

/* ───────────────────────────── a model's classification ───────────────────────────── */

/** The prompt that asks a local model which intent a message has (when the cues are unsure). */
export function classifyPrompt(message) {
  return {
    system: 'Clasifici mesajul proprietarului proiectului CRI Radar (un radar de cercetare crypto și agentul lui de calitate). Răspunzi DOAR cu un obiect JSON, fără alt text.',
    prompt: `Intenții posibile:
status = cum stă proiectul, ce cere atenție
changes = ce s-a schimbat într-un interval (de ieri, azi, săptămâna asta)
gates = lista porților de calitate
diagnose = de ce a eșuat ceva, ce nu merge, cauza unei erori
efficiency = cât de bine identifică radarul proiectele care cresc
forecast = probabilitatea ≥100×/≥20× a unui proiect anume sau cele mai mari probabilități
signals = ce proiecte semnalează radarul acum (candidații de research)
rules = regulile și pragurile de evaluare
learning = ce a învățat agentul, auto-evaluarea lui
run = cererea de a porni un workflow (o scanare, un puls)
code = cererea de a scrie sau modifica cod
help = ce poate face agentul
ask = o întrebare despre cum funcționează ceva

Mesaj: """${String(message).slice(0, 600)}"""

JSON: {"intent": "<una din intenții>", "symbol": "<simbolul proiectului sau null>", "gate": "<id-ul porții sau null>", "rule": "<id-ul regulii sau null>"}`,
  };
}

/** The model's classification, checked against the vocabulary (anything else is ignored). */
export function parseClassification(text, { catalogue = [], symbols = null } = {}) {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  if (!m) return null;
  let o;
  try {
    o = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const intent = String(o?.intent ?? '').toLowerCase().trim();
  if (!INTENTS.includes(intent) || intent === 'greet') return null;
  const ids = new Set((catalogue ?? []).map((g) => g.id));
  const sym = typeof o.symbol === 'string' ? o.symbol.replace(/^\$/, '').toUpperCase() : null;
  const gate = typeof o.gate === 'string' && ids.has(o.gate) ? o.gate : null;
  const rule = typeof o.rule === 'string' && /^(P|ID|FC|MON)-\d{1,2}$/i.test(o.rule) ? o.rule.toUpperCase() : null;
  return { intent, symbol: sym && /^[A-Z0-9]{2,12}$/.test(sym) && (!(symbols instanceof Set) || symbols.has(sym)) ? sym : null, gate, rule };
}
