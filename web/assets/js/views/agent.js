/**
 * AGENT AI — the quality agent's report (data/agent.json, published by agent/main.js on the
 * cri-agent branch and copied into the site by the scan and the pulse). Loaded only when the screen
 * is opened, like the Univers table.
 *
 * Every number comes from the report: the gates and their evidence, the cadence GitHub delivered,
 * the measured efficiency against a professional desk, what the agent learned (norms, incidents and
 * the commits that fixed them, the forecast ledger) and what it did.
 */
import { html, tip } from '../core/dom.js';
import { ago, dateTime, num } from '../core/format.js';
import { icon } from '../core/labels.js';

export const agentState = { status: 'idle', data: null, error: null };

let pending = null;
/** Load data/agent.json once per page view. */
export function ensureAgent(url = 'data/agent.json') {
  if (agentState.status === 'ready' || agentState.status === 'error') return Promise.resolve();
  agentState.status = 'loading';
  pending ??= fetch(url, { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(res.status === 404 ? 'agentul nu a publicat încă un raport' : `HTTP ${res.status}`);
      const doc = await res.json();
      if (!Array.isArray(doc?.gates) || !doc?.summary) throw new Error('structură neașteptată a fișierului agent.json');
      agentState.data = doc;
      agentState.status = 'ready';
    })
    .catch((err) => {
      agentState.status = 'error';
      agentState.error = String(err?.message ?? err);
    });
  return pending;
}

const TONE = { PASS: 'good', WARN: 'warning', FAIL: 'critical', UNKNOWN: 'muted', LEARNING: 'muted' };
const LABEL = { PASS: 'trecut', WARN: 'atenționare', FAIL: 'eșuat', UNKNOWN: 'necunoscut', LEARNING: 'în învățare' };
const ICON = { PASS: 'check', WARN: 'warn', FAIL: 'stop', UNKNOWN: 'dash', LEARNING: 'clock' };
const SEV = { critical: 'critic', serious: 'serios', warning: 'atenționare', info: 'info' };
const NORM = { NORMAL: { label: 'în normă', tone: 'good' }, ANOMALY: { label: 'anomalie', tone: 'warning' }, LEARNING: { label: 'în învățare', tone: 'muted' } };
const fx = (x, d = 1) => (Number.isFinite(x) ? num(x, d) : '—');
const pc = (x, d = 1) => (Number.isFinite(x) ? `${num(x, d)}%` : '—');
const hrs = (x) => (Number.isFinite(x) ? (x >= 48 ? `${num(x / 24, 1)} z` : `${num(x, 1)} h`) : '—');
/** Counts without decimals, measurements with two. */
const val = (x) => (Number.isFinite(x) ? (Number.isInteger(x) ? num(x) : num(x, 2)) : '—');
const meter = (ratio) => (ratio === null ? html`<span class="muted xs">—</span>` : html`<span class="ameter"><span class="ameter-track"><b style="width:${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(1)}%"></b></span><span class="xs">${pc(ratio * 100, 0)}</span></span>`);

const pill = (status) => html`<span class="pill" data-tone="${TONE[status] ?? 'muted'}">${icon(ICON[status] ?? 'dot', 11)} ${LABEL[status] ?? status}</span>`;

function head(extra = '') {
  return html`<div class="view-head"><div>
    <h2 class="view-title">Agent AI — porțile de calitate</h2>
    <p class="view-lede">Un modul separat de scanner care monitorizează gratuit toate verificările proiectului — CI pe fiecare push, fiecare scanare live, cadența reală a programărilor, sursele, cotele planurilor gratuite, site-ul publicat, calibrarea prognozei — și învață din istoricul proiectului: normele lui, incidentele trecute și commiturile care le-au rezolvat. Rezumatul este scris de un model deschis rulat local în runner (fără cont, fără cheie), verificat cifră cu cifră. Singurele acțiuni permise: pornirea unei scanări sau a unui puls sărit de GitHub și o problemă GitHub cu ce cere atenție.</p>
    ${extra}
  </div></div>`;
}

function gateRow(g) {
  return html`<tr>
    <td>${pill(g.status)}</td>
    <td style="white-space:normal;min-width:200px"><span class="tok"><span data-tip="${tip(g.what ?? '')}">${g.title}</span><span class="tok-sub">${g.id}</span></span></td>
    <td class="n xs">${g.value ?? '—'}</td>
    <td class="ink2" style="white-space:normal;min-width:260px">${g.evidence}${g.remedy && g.status !== 'PASS' ? html`<br><span class="xs"><b>Remediu:</b> ${g.remedy}</span>` : ''}</td>
    <td class="xs">${g.link ? html`<a href="${g.link}" target="_blank" rel="noopener" aria-label="deschide rularea">${icon('external', 11)}</a>` : ''}</td>
  </tr>`;
}

/** The same gate on a phone: a stacked row instead of a five-column table. */
function gateCard(g) {
  return html`<div class="card-row agent-row">
    <span>${pill(g.status)} <b>${g.title}</b></span>
    <span class="xs muted">${g.value ?? ''}</span>
    <div class="line">${g.evidence}${g.remedy && g.status !== 'PASS' ? html`<br><b>Remediu:</b> ${g.remedy}` : ''}${g.link ? html` <a href="${g.link}" target="_blank" rel="noopener" aria-label="deschide rularea">${icon('external', 11)}</a>` : ''}</div>
  </div>`;
}

function findingCard(f) {
  const lesson = f.lesson?.lastFix
    ? html`<p class="small" style="margin:6px 0 0">${icon('info', 12)} <b>Din istoric:</b> data trecută s-a rezolvat prin commitul <code>${String(f.lesson.lastFix.sha ?? '').slice(0, 7)}</code> „${f.lesson.lastFix.message}”${Number.isFinite(f.lesson.lastFix.durationHours) ? `, după ${hrs(f.lesson.lastFix.durationHours)}` : ''}.</p>`
    : f.lesson?.transient
      ? html`<p class="small" style="margin:6px 0 0">${icon('info', 12)} <b>Din istoric:</b> s-a rezolvat singur de ${f.lesson.transient} ori până acum.</p>`
      : '';
  return html`<li class="panel agent-finding">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${pill(f.status)} <span class="pill" data-tone="muted">${SEV[f.severity] ?? f.severity}</span> <b>${f.title}</b>${f.count > 1 ? html` <span class="muted xs">văzut de ${f.count} ori, din ${dateTime(f.firstSeen)}</span>` : ''}</div>
    <p class="small ink2" style="margin:6px 0 0">${f.evidence}</p>
    ${f.remedy ? html`<p class="small" style="margin:6px 0 0"><b>Remediu:</b> ${f.remedy}</p>` : ''}
    ${lesson}
  </li>`;
}

function cadenceRow(c) {
  const ratio = Number.isFinite(c.ratio) ? c.ratio : null;
  return html`<tr>
    <td><span class="tok"><span>${c.name}</span><span class="tok-sub">${[].concat(c.cron ?? []).join(' + ') || 'la push'}</span></span></td>
    <td class="n">${Number.isFinite(c.expectedPerDay) ? fx(c.expectedPerDay, c.expectedPerDay < 1 ? 2 : 0) : '—'}</td>
    <td class="n">${fx(c.perDay, 2)}</td>
    <td style="min-width:150px">${meter(ratio)}</td>
    <td class="n">${hrs(c.medianGapHours)}</td>
    <td class="n">${hrs(c.maxGapHours)}</td>
    <td class="n">${pc(c.reliability, 0)}</td>
    <td class="xs">${c.lastAt ? ago(c.lastAt) : '—'}</td>
  </tr>`;
}

function cadenceCard(c) {
  const ratio = Number.isFinite(c.ratio) ? c.ratio : null;
  return html`<div class="card-row agent-row">
    <span><b>${c.name}</b> <span class="tok-sub">${[].concat(c.cron ?? []).join(' + ') || 'la push'}</span></span>
    <span>${meter(ratio)}</span>
    <div class="line"><span>${fx(c.perDay, 2)} pe zi${Number.isFinite(c.expectedPerDay) ? ` din ${fx(c.expectedPerDay, c.expectedPerDay < 1 ? 2 : 0)} promise` : ''}</span><span>interval median ${hrs(c.medianGapHours)}, maxim ${hrs(c.maxGapHours)}</span><span>reușite ${pc(c.reliability, 0)}</span><span>ultima ${c.lastAt ? ago(c.lastAt) : '—'}</span></div>
  </div>`;
}

function efficiencyBlock(e) {
  if (!e?.capability) return html`<p class="muted small">Eficiența se calculează după prima scanare publicată.</p>`;
  return html`<div class="qbar">
      <div class="qstat"><b class="num">${pc(e.effective)}</b><span>eficiență efectivă</span><small class="muted">față de un desk profesional în timp real; ținta de design ${pc(e.design)}</small></div>
      <div class="qstat"><b class="num">${pc(e.capability.achieved)}</b><span>paritate realizată</span><small class="muted">${pc(e.capability.permanent)} permanent · ${pc(e.capability.withKeys)} cu chei gratuite</small></div>
      <div class="qstat"><b class="num">${pc(e.freshness?.observed)}</b><span>prospețime livrată</span><small class="muted">promisă de cron: ${pc(e.freshness?.promised)}</small></div>
      <div class="qstat"><b class="num">${pc(e.reliability)}</b><span>scanări reușite</span><small class="muted">ultimele 14 zile</small></div>
    </div>
    ${(e.levers ?? []).length ? html`<h4 class="section-title" style="margin-top:14px;font-size:var(--fs-sm)">Unde se pierde eficiența</h4><div class="bars">${e.levers.map((l) => html`<div class="bar-row"><span class="lbl" style="white-space:normal">${l.label}</span><span class="track"><b style="width:${Math.min(100, (l.points / Math.max(1, e.levers[0].points)) * 100).toFixed(1)}%"></b></span><span class="val">−${fx(l.points)} p</span></div>`)}</div>` : ''}
    <p class="panel-note">${e.note}</p>`;
}

function normRow(n) {
  const st = NORM[n.status] ?? NORM.LEARNING;
  return html`<tr><td style="white-space:normal">${n.label}</td><td class="n">${n.n}</td><td class="n">${val(n.median)}</td><td class="n">${val(n.last)}</td><td class="n">${Number.isFinite(n.z) ? fx(n.z, 2) : '—'}</td><td><span class="pill" data-tone="${st.tone}">${st.label}</span></td></tr>`;
}

function normCard(n) {
  const st = NORM[n.status] ?? NORM.LEARNING;
  return html`<div class="card-row agent-row"><span>${n.label}</span><span class="pill" data-tone="${st.tone}">${st.label}</span><div class="line"><span>ultima ${val(n.last)}</span><span>mediana ${val(n.median)}</span><span>${n.n} observații</span>${Number.isFinite(n.z) ? html`<span>z ${fx(n.z, 2)}</span>` : ''}</div></div>`;
}

function incidentRow(i) {
  const fix = i.resolvedBy?.sha ? html`<code>${i.resolvedBy.sha.slice(0, 7)}</code> „${i.resolvedBy.message}”` : i.resolvedBy?.transient ? html`<span class="muted">s-a rezolvat singur (trecător)</span>` : html`<span class="muted">deschis</span>`;
  return html`<tr><td style="white-space:normal">${i.title}<br><span class="tok-sub">${i.gate}</span></td><td class="xs">${dateTime(i.firstSeen)}</td><td class="n">${hrs(i.durationHours)}</td><td class="n">${i.count}</td><td class="xs" style="white-space:normal;min-width:220px">${fix}</td></tr>`;
}

function incidentCard(i) {
  const fix = i.resolvedBy?.sha ? html`rezolvat de <code>${i.resolvedBy.sha.slice(0, 7)}</code> „${i.resolvedBy.message}”` : i.resolvedBy?.transient ? 's-a rezolvat singur (trecător)' : 'deschis';
  return html`<div class="card-row agent-row"><span><b>${i.title}</b></span><span class="xs muted">${dateTime(i.firstSeen)}</span><div class="line"><span>${fix}</span>${Number.isFinite(i.durationHours) ? html`<span>după ${hrs(i.durationHours)}</span>` : ''}<span>${i.count} ${i.count === 1 ? 'rulare' : 'rulări'}</span></div></div>`;
}

function calibrationBlock(c) {
  if (!c) return '';
  const i20 = c.interim?.['20'];
  const i100 = c.interim?.['100'];
  return html`<div class="qbar">
      <div class="qstat"><b class="num">${num(c.predictions ?? 0)}</b><span>prognoze înregistrate</span><small class="muted">${num(c.cohorts ?? 0)} cohorte săptămânale · ${num(c.tracked ?? 0)} urmărite cu prețul pieței</small></div>
      <div class="qstat"><b class="num">${num(i20?.observed ?? 0)} / ${fx(i20?.expected, 2)}</b><span>≥20× observate / așteptate</span><small class="muted">până acum, pe toate cohortele</small></div>
      <div class="qstat"><b class="num">${num(i100?.observed ?? 0)} / ${fx(i100?.expected, 2)}</b><span>≥100× observate / așteptate</span><small class="muted">${Number.isFinite(c.skill?.['20']) ? `skill Brier ≥20×: ${fx(c.skill['20'], 3)}` : 'Brier-ul se calculează la scadența de 12 luni'}</small></div>
    </div>
    ${(c.hits ?? []).length ? html`<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Proiect</th><th>Cohorta</th><th class="n">Multiplu</th><th class="n">Prognoză ≥20×</th><th class="n">Prognoză ≥100×</th></tr></thead><tbody>${c.hits.map((h) => html`<tr><td>${h.symbol}</td><td class="xs">${h.cohort}</td><td class="n">${fx(h.multiple)}×</td><td class="n">${pc(h.p20, 2)}</td><td class="n">${pc(h.p100, 3)}</td></tr>`)}</tbody></table></div>` : ''}
    <p class="panel-note">În fiecare săptămână agentul notează probabilitățile publicate pentru fiecare proiect verificat, apoi urmărește maximul de 24 h al prețului. Până la scadență compară câte creșteri au apărut cu câte implica prognoza; la 12 luni calculează scorul Brier față de rata de bază — singurul număr care spune dacă ajustarea după amprentă adaugă informație.</p>`;
}

export function agentMarkup() {
  if (agentState.status === 'idle' || agentState.status === 'loading') return html`${head()}<div class="empty"><strong>Se încarcă raportul agentului…</strong></div>`;
  if (agentState.status === 'error') {
    return html`${head()}<div class="empty"><strong>Raportul agentului nu este disponibil (${agentState.error}).</strong>
      <p>Agentul rulează în workflow-ul „Agent AI” după fiecare CI, scanare și sondă. Prima lui rulare creează ramura <code>cri-agent</code>; site-ul include raportul de la următoarea scanare sau următorul puls. Local: <code>npm run agent:demo</code>.</p></div>`;
  }
  const r = agentState.data;
  const k = r.summary.counts;
  const n = r.narrative;
  const byGroup = (g) => r.gates.filter((x) => x.group === g.id);
  const findings = r.findings ?? [];
  const resolved = r.incidents?.resolved ?? [];
  const open = r.incidents?.open ?? [];
  return html`${head(html`<p class="small muted" style="margin-top:6px">Raport din ${dateTime(r.generatedAt)} (${ago(r.generatedAt)})${r.mode === 'demo' ? ' · DEMO, istoric simulat' : ''}${r.repo ? ` · ${r.repo}` : ''}</p>`)}
    <div class="qbar">
      <div class="qstat" data-tone="${TONE[r.overall] === 'critical' ? 'critical' : TONE[r.overall] === 'warning' ? 'warning' : ''}"><b class="num">${LABEL[r.overall] ?? r.overall}</b><span>stare generală</span><small class="muted">${num(r.summary.total)} porți evaluate</small></div>
      <div class="qstat"><b class="num">${num(k.PASS)}</b><span>trecute</span><small class="muted">${num(k.UNKNOWN + k.LEARNING)} fără date sau în învățare</small></div>
      <div class="qstat" data-tone="${k.WARN ? 'warning' : ''}"><b class="num">${num(k.WARN)}</b><span>atenționări</span></div>
      <div class="qstat" data-tone="${k.FAIL ? 'critical' : ''}"><b class="num">${num(k.FAIL)}</b><span>eșecuri</span></div>
      <div class="qstat"><b class="num">${num(r.learning?.incidents?.resolved ?? 0)}</b><span>incidente rezolvate</span><small class="muted">${num(r.learning?.fixes ?? 0)} ${r.learning?.fixes === 1 ? 'remediere reținută' : 'remedieri reținute'} · ${num(r.learning?.runs ?? 0)} ${r.learning?.runs === 1 ? 'rulare a agentului' : 'rulări ale agentului'}</small></div>
    </div>

    ${n?.text ? html`<section class="section"><h3 class="section-title">Rezumat</h3>
      <div class="panel agent-summary">${n.text.split('\n').filter(Boolean).map((line) => html`<p class="small" style="margin:0 0 6px">${line.replace(/^-\s*/, '')}</p>`)}</div>
      <p class="panel-note">${n.by === 'llm' ? html`${icon('check', 12)} Scris de <b>${n.model}</b>, un model deschis rulat local în runner; fiecare cifră a fost verificată față de fapte.` : html`${icon('info', 12)} Șablon determinist${n.reason && n.reason !== 'disabled' ? ` — ${n.reason}` : ''}.`}</p>
    </section>` : ''}

    ${findings.length ? html`<section class="section"><h3 class="section-title">Ce cere atenție (${findings.length})</h3><ul style="list-style:none;padding:0;margin:0;display:grid;gap:8px">${findings.map(findingCard)}</ul></section>` : html`<section class="section"><div class="empty"><strong>${icon('check', 14)} Nicio poartă în atenționare sau eșec.</strong></div></section>`}

    ${r.groups.map((g) => html`<section class="section">
      <h3 class="section-title">${g.label} <span class="muted xs">${g.counts.PASS}/${byGroup(g).length} trecute</span></h3>
      <div class="tbl-wrap responsive"><table class="tbl"><thead><tr><th>Stare</th><th>Poartă</th><th class="n">Valoare</th><th>Dovadă</th><th></th></tr></thead><tbody>${byGroup(g).map(gateRow)}</tbody></table></div>
      <div class="cards">${byGroup(g).map(gateCard)}</div>
    </section>`)}

    <section class="section"><h3 class="section-title">Cadența reală față de cron</h3>
      <div class="tbl-wrap responsive"><table class="tbl"><thead><tr><th>Workflow</th><th class="n">Promise/zi</th><th class="n">Efective/zi</th><th>Livrat</th><th class="n">Interval median</th><th class="n">Interval maxim</th><th class="n">Reușite</th><th>Ultima</th></tr></thead><tbody>${(r.cadence ?? []).map(cadenceRow)}</tbody></table></div>
      <div class="cards">${(r.cadence ?? []).map(cadenceCard)}</div>
      <p class="panel-note">GitHub rulează programările „best effort” și sare o parte din ele la orele aglomerate. Agentul completează cadența cu workflow_dispatch când nu rulează nimic${r.plan?.skipped?.length ? ` (acum: ${r.plan.skipped.map((x) => `${x.workflow} — ${x.reason}`).join('; ')})` : ''}.</p>
    </section>

    <section class="section"><h3 class="section-title">Eficiența față de soluțiile profesionale</h3>${efficiencyBlock(r.efficiency)}</section>

    <section class="section"><h3 class="section-title">Ce a învățat din istoric</h3>
      <div class="tbl-wrap responsive"><table class="tbl"><thead><tr><th>Normă</th><th class="n">Observații</th><th class="n">Mediana</th><th class="n">Ultima</th><th class="n">z robust</th><th>Stare</th></tr></thead><tbody>${(r.norms ?? []).map(normRow)}</tbody></table></div>
      <div class="cards">${(r.norms ?? []).map(normCard)}</div>
      <p class="panel-note">Fiecare valoare nouă este judecată față de normele învățate din rulările anterioare (mediană și abatere absolută mediană, deci un vârf trecut nu mută norma); sub ${r.learning?.minSamples ?? 8} observații verdictul rămâne „în învățare”.</p>
      ${resolved.length || open.length ? html`<h4 class="section-title" style="margin-top:14px;font-size:var(--fs-sm)">Incidente și remedieri</h4>
      <div class="tbl-wrap responsive"><table class="tbl"><thead><tr><th>Poartă</th><th>De la</th><th class="n">Durată</th><th class="n">Rulări</th><th>Ce l-a rezolvat</th></tr></thead><tbody>${[...open, ...resolved].map(incidentRow)}</tbody></table></div>
      <div class="cards">${[...open, ...resolved].map(incidentCard)}</div>` : ''}
    </section>

    <section class="section"><h3 class="section-title">Calibrarea prognozei ≥100×</h3>${calibrationBlock(r.calibration)}</section>

    ${(r.recentActions ?? []).length ? html`<section class="section"><h3 class="section-title">Acțiuni recente</h3><ul class="facts">${r.recentActions.map((a) => html`<li><span><b>${dateTime(a.at)}</b> — ${a.ok ? 'a pornit' : 'nu a putut porni'} <code>${a.workflow}</code>: ${a.reason}</span></li>`)}</ul></section>` : ''}

    <section class="section"><h3 class="section-title">Reguli</h3>
      <ul class="facts">
        <li><span><b>Gratuit.</b> Tokenul automat al workflow-ului (API GitHub), câteva apeluri publice CoinGecko fără cheie și un model deschis rulat local în runner (Ollama); niciun abonament, niciun secret citit.</span></li>
        <li><span><b>Exclusiv observare.</b> Acțiuni permise: ${(r.policy?.actionsAllowed ?? []).join('; ')}. Agentul nu poate anula, șterge, relua cu alți parametri sau modifica cod.</span></li>
        <li><span><b>Configurare</b> (Settings → Secrets and variables → Actions → Variables): <code>CRI_AGENT_LLM=off</code> dezactivează modelul local, <code>CRI_AGENT_MODEL</code> alege alt model deschis, <code>CRI_AGENT_HEAL=off</code> oprește pornirile automate, <code>CRI_AGENT_ISSUES=off</code> oprește problema GitHub.</span></li>
      </ul>
    </section>`;
}
