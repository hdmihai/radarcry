/**
 * SIGNATURES — known ways this project fails, each with its cause and remedy, in the dashboard's
 * language. A failure message (an annotation, a provider message, a step name) is matched against the
 * table; the first match names the cause. What the agent *learns* sits on top: the commit that
 * resolved a signature last time is remembered and quoted the next time it appears (incidents.js).
 *
 * Pure data and one pure function.
 */

export const SIGNATURES = Object.freeze([
  { code: 'PAGES_SETTINGS', re: /Pages nu este activat|publică dintr-o ramură|Pages.*(not enabled|build_type)/i, cause: 'GitHub Pages nu publică din Actions', remedy: 'Settings → Pages → Build and deployment → Source: „GitHub Actions”, apoi rulați din nou „Scan & deploy”. Starea cercetării este deja salvată.' },
  { code: 'PUSH_DENIED', re: /denied to github-actions|Permission to .* denied|non-fast-forward|\[rejected\]/i, cause: 'workflow-ul nu poate scrie pe ramura de stare', remedy: 'Settings → Actions → General → Workflow permissions: „Read and write permissions”.' },
  { code: 'CONFIG', re: /Configurație invalidă/i, cause: 'configurația nu trece verificarea la pornire', remedy: 'corectați config/local.json sau variabilele CRI_* indicate în mesaj; valorile implicite din config/default.json sunt valide.' },
  { code: 'UNAPPROVED_HOST', re: /nu este pe lista de surse aprobate/i, cause: 'un adaptor apelează un host neaprobat', remedy: 'adăugați hostul în APPROVED_HOSTS (test/architecture.test.js) cu planul gratuit pe care rulează, sau scoateți apelul.' },
  { code: 'PAID_HOST', re: /plan plătit|abonament|nu are nivel gratuit/i, cause: 'codul apelează un serviciu cu abonament', remedy: 'scoateți apelul: proiectul folosește doar API-uri publice sau cu cont gratuit; platforma poate rămâne ca link web gratuit.' },
  { code: 'TRADING_ENDPOINT', re: /endpoint de execuție/i, cause: 'a apărut un endpoint de ordine sau retragere', remedy: 'scoateți endpoint-ul: proiectul este exclusiv de research.' },
  { code: 'LAYER_VIOLATION', re: /\bimports\b|importă|stratul/i, cause: 'o dependență încalcă arhitectura hexagonală', remedy: 'mutați dependența spre interior: domeniul nu importă nimic din afară, aplicația doar domeniul și porturile, adaptoarele niciodată rădăcina de compoziție.' },
  { code: 'NONDETERMINISTIC', re: /Date\.now|Math\.random|citește ceasul|reproductibil/i, cause: 'domeniul citește ceasul sau folosește aleatoriu', remedy: 'primiți timpul ca argument explicit (nowMs) de la rădăcina de compoziție.' },
  { code: 'CONTRACT', re: /INVALID .*erori|schema|contract/i, cause: 'snapshot-ul publicat nu respectă schema', remedy: 'rulați local „npm run scan:demo && npm run validate”; versiunea schemei (schema/latest.schema.json) și a motorului trebuie să coincidă.' },
  { code: 'RATE_LIMIT', re: /HTTP 429|RATE_LIMITED|rate.?limit|limită de rată|Too Many Requests/i, cause: 'limită de rată la un furnizor gratuit', remedy: 'normal pe IP-urile partajate ale GitHub, rularea continuă cu ce a primit; dacă persistă, configurați cheia gratuită a furnizorului (CoinGecko Demo, CMC Basic) sau micșorați maxCalls în config/default.json.' },
  { code: 'QUOTA', re: /QUOTA_EXHAUSTED|BUDGET_EXHAUSTED|cota|quota/i, cause: 'bugetul lunar sau pe rulare al unui plan gratuit este epuizat', remedy: 'poarta de cote oprește singură furnizorul până la resetare; verificați ecranul „Paritate și bugete” și reduceți cadența sau maxCalls.' },
  { code: 'TIMEOUT', re: /timed out|timeout|TIMEOUT|exceeded the maximum execution time|maximum execution time/i, cause: 'rularea sau un furnizor a depășit timpul', remedy: 'reduceți runtime.maxMinutes sau deep.limit; ecranul „Date și surse” arată furnizorul lent.' },
  { code: 'NETWORK', re: /ENOTFOUND|ECONNRESET|EAI_AGAIN|NETWORK_ERROR|fetch failed|socket hang up/i, cause: 'eroare de rețea spre un furnizor', remedy: 'de obicei trecătoare; dacă se repetă săptămânal în sondă, furnizorul blochează IP-urile GitHub.' },
  { code: 'DISK', re: /No space left on device/i, cause: 'disc plin pe runner', remedy: 'reduceți fișierele de stare (history, deep-cache) sau curățați artefactele.' },
  { code: 'TEST_FAILURE', re: /tests? fail|# fail [1-9]|not ok \d+/i, cause: 'un test a eșuat', remedy: 'rulați „npm run ci” local; mesajul testului numește regula încălcată.' },
]);

/** The first signature that matches any of the texts, or null. */
export function classify(...texts) {
  const text = texts.flat().filter((x) => typeof x === 'string' && x).join('\n');
  if (!text) return null;
  const s = SIGNATURES.find((x) => x.re.test(text));
  return s ? { code: s.code, cause: s.cause, remedy: s.remedy } : null;
}
