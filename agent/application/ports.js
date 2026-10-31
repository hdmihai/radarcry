/**
 * PORTS of the agent — what the use-cases need from the outside world, nothing more. Adapters in
 * agent/adapters implement them (live: GitHub REST, the state directory, the Pages site, CoinGecko's
 * public prices, a local Ollama; offline: agent/adapters/fixtures.js). The use-cases never see a
 * URL, a token or a file path.
 *
 * Every read port answers `{ ok, status, data, message }` and never throws: a missing answer becomes
 * UNKNOWN in a gate, which is not "bad".
 */

/**
 * @typedef {{ok:boolean, status:string, data:any, message?:string}} Result
 */

/**
 * CiPort — the repository's workflows and their runs.
 * @typedef {Object} CiPort
 * @property {() => Promise<Result>} repo            {fullName, defaultBranch, htmlUrl, owner, name}
 * @property {(branch:string) => Promise<Result>} lastCommit  {sha, message, at}
 * @property {() => Promise<Result>} workflows       [{id, name, path, state, createdAt}]
 * @property {(file:string, perPage?:number) => Promise<Result>} runs  [{id, event, status, conclusion, createdAt, updatedAt, startedAt, headSha, headBranch, message, attempt, url}]
 * @property {(runId:number) => Promise<Result>} jobs          [{id, name, conclusion, steps:[{name, conclusion, number}]}]
 * @property {(jobId:number) => Promise<Result>} annotations   [{level, title, message, path}]
 * @property {() => Promise<Result>} [pagesDeployment]  {id, sha, createdAt, state, url, at} of the latest github-pages deployment
 * @property {(file:string, ref:string, inputs?:any) => Promise<Result>} dispatch
 */

/**
 * StatePort — the research state the scanner published (the cri-state branch, or a local data dir).
 * @typedef {Object} StatePort
 * @property {() => Promise<Result>} snapshot   the parsed data/latest.json
 * @property {() => Promise<Result>} universe   the parsed data/universe.json
 * @property {() => Promise<Result>} meta       the state's meta.json
 * @property {() => Promise<Result>} published  [{name, text}] the files the site publishes (secret scan)
 */

/**
 * SitePort — the deployed dashboard.
 * @typedef {Object} SitePort
 * @property {() => Promise<Result>} summary   {url, generatedAt}
 */

/**
 * PricePort — public market prices for the calibration ledger (keyless).
 * @typedef {Object} PricePort
 * @property {(ids:string[]) => Promise<Result>} prices   Map-like object id → {price, high24h}
 */

/**
 * MemoryPort — the agent's own memory and its published report.
 * @typedef {Object} MemoryPort
 * @property {() => Promise<any|null>} load
 * @property {(memory:any) => Promise<void>} save
 * @property {(report:any, markdown:string) => Promise<{path:string}>} publish
 * @property {() => Promise<any|null>} lastReport
 */

/**
 * NarratorPort — a language model that turns facts into prose. Optional.
 * @typedef {Object} NarratorPort
 * @property {string} id
 * @property {string|null} model
 * @property {() => Promise<boolean>} available
 * @property {(prompt:{system:string, prompt:string}) => Promise<Result>} generate   data: text
 */

/**
 * NotifierPort — one rolling GitHub issue with the open findings. Optional.
 * @typedef {Object} NotifierPort
 * @property {(o:{title:string, body:string, open:boolean}) => Promise<Result>} upsert
 */

export {};
