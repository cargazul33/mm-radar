const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const money = (n) => {
  if (n == null || Number.isNaN(Number(n))) return "NO VERIFICADO";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(n));
};
const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;

async function api(path, opts) {
  const r = await fetch(path, {
    headers: { "content-type": "application/json", ...(opts?.headers || {}) },
    ...opts,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function showView(name) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  const el = $(`#view-${name}`);
  if (el) el.classList.remove("hidden");
  $$(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
}

async function loadHoy() {
  const [hoy, tasks, bn, proy, alerts] = await Promise.all([
    api("/api/hoy"),
    api("/api/que-hago-hoy"),
    api("/api/bottleneck"),
    api("/api/proyecciones"),
    api("/api/alertas"),
  ]);
  $("#kpi-capital").textContent = money(hoy.capital_operativo_real);
  $("#kpi-caja").textContent = money(hoy.caja);
  $("#kpi-cxc").textContent = money(hoy.por_cobrar);
  $("#kpi-comp").textContent = money(hoy.comprometido);
  $("#kpi-libre").textContent = money(hoy.libre);
  $("#formula").textContent = hoy.formula;
  const pv = hoy.metas.progress_ventas;
  const pg = hoy.metas.progress_ganancia;
  $("#meta-ventas-label").textContent = `${money(hoy.metas.ventas_reales)} / ${money(hoy.metas.ventas)} (${pct(pv)})`;
  $("#meta-ganancia-label").textContent = `${money(hoy.metas.ganancia_real)} / ${money(hoy.metas.ganancia)} (${pct(pg)})`;
  $("#bar-ventas").style.width = `${Math.min(100, pv * 100)}%`;
  $("#bar-ganancia").style.width = `${Math.min(100, pg * 100)}%`;
  $("#meta-note").textContent = hoy.metas.note;

  const tl = $("#task-list");
  tl.innerHTML = "";
  if (!tasks.tasks?.length) {
    tl.innerHTML = `<div class="muted">Sin tareas derivadas del estado actual de la DB.</div>`;
  } else {
    for (const t of tasks.tasks) {
      const div = document.createElement("div");
      div.className = "row";
      div.innerHTML = `<div class="badge ${t.priority === "urgente" ? "bad" : t.priority === "alta" ? "warn" : ""}">${t.priority}</div>
        <div class="t">${t.action}</div>
        <div class="muted">${t.title}</div>
        <div class="muted">${t.reason}</div>`;
      if (/^\d+$/.test(t.ref_id)) div.onclick = () => openOpp(Number(t.ref_id));
      tl.appendChild(div);
    }
  }

  $("#bottleneck-text").textContent = bn.text;
  $("#bottleneck-sec").innerHTML = (bn.secondary || []).map((s) => `<li>${s}</li>`).join("");

  const pl = $("#proy-list");
  pl.innerHTML = `<div class="warnbox"><strong>${proy.label}</strong> — ${proy.disclaimer}</div>`;
  for (const s of proy.scenarios || []) {
    const d = document.createElement("div");
    d.className = "row";
    d.innerHTML = `<div class="t">${s.scenario.toUpperCase()} · ${s.label}</div>
      <div>Ventas: ${money(s.ventas)} · Ganancia: ${money(s.ganancia)}</div>
      <div class="muted">${s.note}</div>`;
    pl.appendChild(d);
  }

  const al = $("#alert-list");
  al.innerHTML = "";
  if (!alerts.alertas?.length) al.innerHTML = `<div class="muted">Sin alertas abiertas.</div>`;
  for (const a of alerts.alertas || []) {
    const d = document.createElement("div");
    d.className = "row";
    d.innerHTML = `<span class="badge ${a.level === "urgente" ? "bad" : "warn"}">${a.level}</span>
      <div class="t">${a.title}</div><div class="muted">${a.body || ""}</div>`;
    al.appendChild(d);
  }
}

async function loadOps() {
  const data = await api("/api/oportunidades");
  const list = $("#ops-list");
  list.innerHTML = "";
  for (const o of data.oportunidades || []) {
    const d = document.createElement("div");
    d.className = "row";
    const band = (() => {
      try { return JSON.parse(o.mm_score_json || "{}").band || ""; } catch { return ""; }
    })();
    d.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div class="t">#${o.external_id} · score ${o.mm_score ?? "—"}</div>
        <span class="badge ${band}">${band || (o.skipped ? "SKIP" : "—")}</span>
      </div>
      <div>${o.title || ""}</div>
      <div class="muted">${o.organism || ""} · ${o.rubros || ""}</div>
      <div class="muted">Cierre: ${o.cierre_at || "NO VERIFICADO"} · ${o.pipeline} · ${o.stock_label || ""}</div>
      <div class="actions">
        <a class="btn ghost" href="${o.source_url || o.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">URL oficial</a>
        ${o.pliego_descarga ? `<a class="btn primary" href="${o.pliego_descarga}" target="_blank" rel="noopener" onclick="event.stopPropagation()">DESCARGAR PLIEGO</a>` : `<span class="muted">Sin pliego descargable</span>`}
      </div>`;
    d.onclick = () => openOpp(o.id);
    list.appendChild(d);
  }
}

async function openOpp(id) {
  showView("detalle");
  const box = $("#detalle");
  box.innerHTML = `<div class="muted">Cargando…</div>`;
  const d = await api(`/api/oportunidades/${id}`);
  const o = d.opportunity;
  const score = d.score || {};
  box.innerHTML = `
    <div class="card">
      <h2>#${o.external_id} — ${o.title}</h2>
      <div class="muted">${o.organism} · ${o.rubros}</div>
      <div style="margin-top:8px">Pipeline: <strong>${o.pipeline}</strong>
        · Score: <strong>${o.mm_score ?? "—"}</strong>
        <span class="badge ${score.band || ""}">${score.band || ""}</span>
      </div>
      <div class="actions">
        <a class="btn ghost" href="${d.source_url}" target="_blank" rel="noopener">URL oficial</a>
        ${d.download_pliego ? `<a class="btn primary" href="${d.download_pliego}" target="_blank" rel="noopener">DESCARGAR PLIEGO</a>` : ""}
      </div>
      ${o.bid_scope ? `<div class="warnbox">bid_scope: <strong>${o.bid_scope}</strong></div>` : ""}
      <h3 style="margin-top:12px">Score M&M (componentes)</h3>
      <div class="grid">
        <div>Encaje: ${score.encaje ?? 0}/20</div>
        <div>Margen: ${score.margen ?? 0}/20</div>
        <div>Abastecimiento: ${score.abastecimiento ?? 0}/15</div>
        <div>Capital: ${score.capital ?? 0}/10</div>
        <div>Cobro: ${score.cobro ?? 0}/15</div>
        <div>Probabilidad: ${score.probabilidad ?? 0}/10</div>
        <div>Historial: ${score.historial ?? 0}/10</div>
      </div>
      <ul class="why">${(score.why || []).map((w) => `<li>${w}</li>`).join("")}</ul>
    </div>
    <div class="card" style="margin-top:10px">
      <h3>Ítems</h3>
      <div class="list">${(d.items || []).map((it) => `
        <div class="row"><div class="t">#${it.line_no} ${it.description}</div>
        <div class="muted">${it.qty} ${it.unit} · ${it.brand} ${it.model}</div>
        <div class="muted">Costo: ${it.unit_cost != null ? money(it.unit_cost) : "—"} · ${it.cost_label}</div></div>`).join("") || "<div class='muted'>Sin ítems</div>"}</div>
    </div>
    <div class="card" style="margin-top:10px">
      <h3>Proveedores</h3>
      <div><strong>EXACTO</strong> (${d.suppliers.exacto.length})</div>
      ${(d.suppliers.exacto || []).map(s => `<div class="row"><div class="t">${s.supplier_name}</div><div class="muted">${s.product_label} · ${s.unit_cost != null ? money(s.unit_cost) : "PRECIO_NO_VERIFICADO"} · ${s.why}</div></div>`).join("") || "<div class='muted'>ninguno</div>"}
      <div style="margin-top:8px"><strong>EQUIVALENTE</strong> (${d.suppliers.equivalente.length})</div>
      ${(d.suppliers.equivalente || []).map(s => `<div class="row"><div class="t">${s.supplier_name}</div><div class="muted">${s.product_label} · ${s.unit_cost != null ? money(s.unit_cost) : "PRECIO_NO_VERIFICADO"}</div></div>`).join("") || "<div class='muted'>ninguno</div>"}
      <div style="margin-top:8px"><strong>NO MATCH</strong> (${d.suppliers.no.length})</div>
      ${(d.suppliers.no || []).slice(0, 8).map(s => `<div class="row"><div class="t">${s.supplier_name || "—"}</div><div class="muted">${s.product_label || s.why || ""}</div></div>`).join("") || "<div class='muted'>ninguno</div>"}
    </div>
    <div class="card" style="margin-top:10px">
      <h3>Rentabilidad</h3>
      <div class="muted">${d.rentabilidad.label} · ${d.rentabilidad.verification}</div>
      <div class="grid" style="margin-top:8px">
        <div>Costo prod: ${d.rentabilidad.cost_products != null ? money(d.rentabilidad.cost_products) : "PRECIO_NO_VERIFICADO"}</div>
        <div>Flete: ${d.rentabilidad.cost_shipping != null ? money(d.rentabilidad.cost_shipping) : "—"}</div>
        <div>Otros: ${d.rentabilidad.cost_other != null ? money(d.rentabilidad.cost_other) : "—"}</div>
        <div>Total: ${d.rentabilidad.cost_total != null ? money(d.rentabilidad.cost_total) : "PRECIO_NO_VERIFICADO"}</div>
        <div>Venta: ${d.rentabilidad.sell_price != null ? money(d.rentabilidad.sell_price) : "—"}</div>
        <div>Bruto: ${d.rentabilidad.gross != null ? money(d.rentabilidad.gross) : "—"}</div>
        <div>Neto est.: ${d.rentabilidad.net_estimated != null ? money(d.rentabilidad.net_estimated) : "—"}</div>
        <div>Capital: ${d.rentabilidad.capital != null ? money(d.rentabilidad.capital) : "—"}</div>
        <div>ROI: ${d.rentabilidad.roi != null ? pct(d.rentabilidad.roi) : "—"}</div>
        <div>Eficiencia capital: ${d.rentabilidad.capital_efficiency != null ? d.rentabilidad.capital_efficiency : "—"}</div>
      </div>
      ${(d.rentabilidad.invent_flags || []).length ? `<div class="warnbox">${d.rentabilidad.invent_flags.join(" · ")}</div>` : ""}
    </div>`;
}

async function loadCaja() {
  const c = await api("/api/caja");
  $("#caja-formula").textContent = c.formula_es;
  $("#caja-vals").innerHTML = `
    <div class="grid">
      <div class="card"><div class="muted">Caja</div><div class="kpi">${money(c.caja)}</div></div>
      <div class="card"><div class="muted">CxC firmes</div><div class="kpi">${money(c.por_cobrar)}</div></div>
      <div class="card"><div class="muted">Comprometido</div><div class="kpi">${money(c.comprometido)}</div></div>
      <div class="card"><div class="muted">CAPITAL OPERATIVO REAL</div><div class="kpi">${money(c.capital_operativo_real)}</div></div>
      <div class="card"><div class="muted">Libre</div><div class="kpi">${money(c.libre)}</div></div>
    </div>
    <div class="warnbox">Nunca se cuentan cotizaciones (quotes) como caja.</div>`;
  const led = $("#caja-ledger");
  led.innerHTML = (c.ledger || []).map((m) =>
    `<div class="row"><div class="t">${m.tipo} ${money(m.amount)}</div><div class="muted">${m.concept} · ${m.moved_at}</div></div>`
  ).join("") || `<div class="muted">Sin movimientos. Cargá ingresos/egresos reales.</div>`;
}

async function loadCobranzas() {
  const data = await api("/api/cobranzas");
  const list = $("#cob-list");
  list.innerHTML = (data.cobranzas || []).map((c) => `
    <div class="row">
      <div class="t">${money(c.amount)} · ${c.state} · ${c.cobro_label}</div>
      <div class="muted">#${c.external_id || "—"} ${c.opp_title || ""} · vence ${c.due_at || "NO VERIFICADO"}</div>
    </div>`).join("") || `<div class="muted">Sin cobranzas cargadas.</div>`;
}

async function submitOpp(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  try {
    const res = await api("/api/oportunidades", { method: "POST", body: JSON.stringify(body) });
    $("#form-msg").textContent = res.ok ? `OK id=${res.id}` : res.error;
    if (res.ok) { e.target.reset(); await loadOps(); showView("ops"); }
  } catch (err) {
    $("#form-msg").textContent = String(err.message || err);
  }
}

async function submitCaja(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  body.amount = Number(body.amount);
  await api("/api/caja", { method: "POST", body: JSON.stringify(body) });
  e.target.reset();
  await loadCaja();
  await loadHoy();
}

async function refresh() {
  await api("/api/refresh", { method: "POST" });
  await boot();
}

async function boot() {
  showView("hoy");
  await Promise.all([loadHoy(), loadOps(), loadCaja(), loadCobranzas()]);
}

$$(".nav button").forEach((b) => b.addEventListener("click", async () => {
  showView(b.dataset.view);
  if (b.dataset.view === "hoy") await loadHoy();
  if (b.dataset.view === "ops") await loadOps();
  if (b.dataset.view === "caja") await loadCaja();
  if (b.dataset.view === "cob") await loadCobranzas();
}));

$("#form-opp").addEventListener("submit", submitOpp);
$("#form-caja").addEventListener("submit", submitCaja);
$("#btn-refresh").addEventListener("click", refresh);

boot().catch((e) => {
  $("#kpi-capital").textContent = "Error";
  console.error(e);
});
