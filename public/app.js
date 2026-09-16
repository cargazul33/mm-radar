const MODULES = [
  { id: "dashboard", label: "HOY" },
  { id: "hoy", label: "Qué hago hoy" },
  { id: "oportunidades", label: "Oportunidades" },
  { id: "proveedores", label: "Proveedores" },
  { id: "cotizaciones", label: "Cotizaciones" },
  { id: "ops", label: "Ops ganadas" },
  { id: "compras", label: "Compras" },
  { id: "entregas", label: "Entregas" },
  { id: "facturacion", label: "Facturación" },
  { id: "cobranzas", label: "Cobranzas" },
  { id: "caja", label: "Caja" },
  { id: "capital", label: "Capital" },
  { id: "rentabilidad", label: "Rentabilidad" },
  { id: "alertas", label: "Alertas" },
  { id: "indicadores", label: "Indicadores" },
  { id: "proyecciones", label: "Proyecciones" },
];

const PIPELINE = [
  "DETECTADA","NUEVA","ANALISIS","BUSCANDO_PROVEEDOR","COTIZANDO","LISTA_PARA_PRESENTAR",
  "PRESENTADA","OPS_GANADA","COMPRANDO","ENTREGANDO","FACTURANDO","COBRANDO",
  "COBRADA","COBRADO","DESCARTADA","PERDIDA","SKIPPED_HARD",
];

const money = (n) =>
  n == null || Number.isNaN(n)
    ? '<span class="badge nv">NO VERIFICADO</span>'
    : new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

const el = (html) => {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstChild;
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }
  if (!res.ok) throw new Error(res.statusText);
  return res;
}

function flash(msg, ok = true) {
  const n = el(`<div class="flash ${ok ? "ok" : "err"}">${msg}</div>`);
  const app = document.getElementById("app");
  app.prepend(n);
  setTimeout(() => n.remove(), 4500);
}

function setActive(id) {
  document.querySelectorAll("nav.tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.id === id);
  });
  location.hash = id;
}

function pliegoLinks(o) {
  const parts = [];
  if (o.link_oportunidad || o.url) {
    parts.push(`<a href="${o.link_oportunidad || o.url}" target="_blank" rel="noopener">link oportunidad</a>`);
  }
  const p = o.descargar_pliego || {};
  if (p.url || o.pliego_url) {
    parts.push(`<a href="${p.url || o.pliego_url}" target="_blank" rel="noopener">DESCARGAR PLIEGO</a>`);
  } else if (p.file || o.pliego_file) {
    parts.push(`<span class="badge">pliego archivo: ${p.file || o.pliego_file}</span>`);
  }
  return parts.join(" · ") || '<span class="badge nv">sin link/pliego</span>';
}

async function viewDashboard() {
  const d = await api("/api/dashboard");
  const m = d.meta;
  return `
    <div class="grid">
      <div class="card"><h3>Oportunidades</h3><div class="num">${d.hoy.oportunidades_activas}</div></div>
      <div class="card"><h3>Score ≥60</h3><div class="num">${d.hoy.score_alto}</div></div>
      <div class="card"><h3>Presentadas</h3><div class="num">${d.hoy.presentadas}</div></div>
      <div class="card"><h3>Ops ganadas</h3><div class="num">${d.hoy.ops_ganadas}</div></div>
      <div class="card"><h3>Alertas</h3><div class="num">${d.hoy.alertas_abiertas}</div></div>
    </div>
    <div class="card" style="margin-top:.75rem">
      <h3>Meta mensual ${m.year_month}</h3>
      <div>Ventas ${money(m.ventas)} / meta ${money(m.meta_ventas)} (${m.progreso_ventas_pct}%)</div>
      <div class="progress"><span style="width:${Math.min(100, m.progreso_ventas_pct)}%"></span></div>
      <div style="margin-top:.5rem">Ganancia ${money(m.ganancia)} / meta ${money(m.meta_ganancia)} (${m.progreso_ganancia_pct}%)</div>
      <div class="progress"><span style="width:${Math.min(100, m.progreso_ganancia_pct)}%;background:var(--accent)"></span></div>
      <form class="stack" id="ventasForm" style="margin-top:.75rem">
        <div class="toolbar">
          <label>Ventas <input name="ventas" type="number" value="${m.ventas}" /></label>
          <label>Ganancia <input name="ganancia" type="number" value="${m.ganancia}" /></label>
          <button class="btn" type="submit">Actualizar meta HOY</button>
        </div>
      </form>
    </div>
    <div class="card" style="margin-top:.75rem">
      <h3>Capital operativo</h3>
      ${
        d.capital
          ? `<div class="num">${money(d.capital.capital_operativo_real)}</div>
             <div class="muted">${d.capital.formula}</div>
             ${(d.capital.alerts || []).map((a) => `<div class="badge urgente">${a}</div>`).join(" ")}`
          : `<span class="badge nv">NO VERIFICADO — cargar en J Capital</span>`
      }
    </div>
    <p class="muted" style="margin-top:.75rem">${d.policy.policy}</p>
  `;
}

async function viewHoy() {
  const d = await api("/api/que-hago-hoy");
  const groups = { urgente: [], alta: [], oportunidades: [] };
  for (const t of d.tasks) groups[t.priority]?.push(t);
  const block = (prio, title) => `
    <div class="card" style="margin-bottom:.75rem">
      <h3><span class="badge ${prio}">${prio}</span> ${title} (${groups[prio].length})</h3>
      <ul class="tasks">
        ${
          groups[prio].length
            ? groups[prio]
                .map(
                  (t) => `<li>
              <div class="action">${t.action}</div>
              <div>${t.title}</div>
              <div class="muted">${t.reason} · ref #${t.ref_id}</div>
            </li>`
                )
                .join("")
            : `<li class="muted">Sin tareas en esta banda (no se inventan).</li>`
        }
      </ul>
    </div>`;
  return `
    <p class="muted">${d.note}</p>
    ${block("urgente", "Urgente")}
    ${block("alta", "Alta")}
    ${block("oportunidades", "Oportunidades")}
  `;
}

async function viewOportunidades() {
  const d = await api("/api/oportunidades");
  return `
    <div class="toolbar">
      <button class="btn" id="btnNewOpp">+ Manual</button>
      <button class="btn secondary" id="btnImport">Importar JSON</button>
      <a class="btn secondary" href="/api/backup/csv?table=opportunities">CSV</a>
      <a class="btn secondary" href="/api/backup/json">Backup JSON</a>
    </div>
    <div id="oppForms"></div>
    <div class="card" style="overflow:auto">
      <table>
        <thead><tr>
          <th>ID</th><th>Título</th><th>Score</th><th>Pipeline</th><th>Utilidad</th><th>Links</th><th></th>
        </tr></thead>
        <tbody>
          ${d.items
            .map(
              (o) => `<tr>
            <td>${o.external_id}<div class="muted">#${o.id}</div></td>
            <td>${o.title || "—"}<div class="muted">${o.organism || ""}</div></td>
            <td><span class="badge ${(o.mm_score_json && JSON.parse(o.mm_score_json||"{}").band) || ""}">${o.mm_score ?? "—"}</span></td>
            <td>
              <select data-pipe="${o.id}">
                ${PIPELINE.map((p) => `<option value="${p}" ${p === o.pipeline ? "selected" : ""}>${p}</option>`).join("")}
              </select>
            </td>
            <td>${money(o.utilidad_estimada)}<div class="muted">${o.verification || ""}</div></td>
            <td class="row-actions">${pliegoLinks(o)}</td>
            <td><button class="btn secondary" data-detail="${o.id}">Ver</button></td>
          </tr>`
            )
            .join("") || `<tr><td colspan="7" class="muted">Sin oportunidades importadas/creadas.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div id="oppDetail"></div>
  `;
}

function formNewOpp() {
  return `
    <div class="card" style="margin-bottom:.75rem">
      <h3>Alta manual (no inventar costos)</h3>
      <form class="stack" id="newOppForm">
        <label>external_id (CODINEU) <input name="external_id" required /></label>
        <label>Título <input name="title" required /></label>
        <label>Organismo <input name="organism" /></label>
        <label>URL oportunidad <input name="url" /></label>
        <label>URL pliego <input name="pliego_url" /></label>
        <label>Apertura/cierre <input name="apertura_at" placeholder="23/09/26 09:00 ART" /></label>
        <label>Fit hint 0-100 <input name="fit_hint" type="number" /></label>
        <label>Notas <textarea name="notes"></textarea></label>
        <button class="btn" type="submit">Crear</button>
      </form>
    </div>`;
}

function formImport() {
  return `
    <div class="card" style="margin-bottom:.75rem">
      <h3>Import JSON (mm-ai-commerce / CODINEU export)</h3>
      <form class="stack" id="importForm">
        <label>JSON<textarea name="json" placeholder='{"opportunities":[...]}'></textarea></label>
        <button class="btn" type="submit">Importar</button>
      </form>
    </div>`;
}

async function showOppDetail(id) {
  const o = await api(`/api/oportunidades/${id}`);
  const b = o.mm_score_breakdown || {};
  const max = { encaje: 20, margen: 20, abastecimiento: 15, capital: 10, cobro: 15, probabilidad: 10, historial: 10 };
  const bars = Object.keys(max)
    .map((k) => {
      const v = b[k] ?? 0;
      const pct = Math.round((v / max[k]) * 100);
      return `<div class="bar-row"><span>${k}</span><div class="track"><i style="width:${pct}%"></i></div><span>${v}</span></div>`;
    })
    .join("");
  document.getElementById("oppDetail").innerHTML = `
    <div class="card" style="margin-top:.75rem">
      <h3>Detalle #${o.id} · ${o.external_id}</h3>
      <p>${o.title}</p>
      <p class="row-actions">${pliegoLinks(o)}</p>
      <p>M&M SCORE <strong>${o.mm_score ?? "—"}</strong> <span class="badge ${b.band || ""}">${b.band || ""}</span>
         · riesgo ${o.risk_level || "NO VERIFICADO"} · match ${o.match_type || "—"} · stock_verified=${!!o.stock_verified}</p>
      <div class="score-bars">${bars}</div>
      ${(b.why || []).map((w) => `<div class="why">· ${w}</div>`).join("")}
      <h3 style="margin-top:.75rem">Ítems</h3>
      <table><thead><tr><th>#</th><th>Desc</th><th>Qty</th><th>Costo</th><th>Verif</th></tr></thead>
      <tbody>${(o.items||[]).map(i=>`<tr><td>${i.line_no}</td><td>${i.description}</td><td>${i.qty}</td><td>${money(i.unit_cost)}</td><td>${i.verification}</td></tr>`).join("")||`<tr><td colspan="5" class="muted">Sin ítems</td></tr>`}</tbody></table>
    </div>`;
}

async function viewProveedores() {
  const d = await api("/api/proveedores");
  return `
    <div class="card">
      <h3>Alta / match</h3>
      <form class="stack" id="supForm">
        <label>Nombre <input name="name" required /></label>
        <label>Email <input name="email" /></label>
        <label>WhatsApp <input name="whatsapp" /></label>
        <label><input type="checkbox" name="verified" /> Verificado</label>
        <button class="btn" type="submit">Guardar proveedor</button>
      </form>
      <hr style="border-color:var(--border);margin:1rem 0" />
      <form class="stack" id="matchForm">
        <label>Opp ID <input name="opportunity_id" type="number" /></label>
        <label>Pedido <input name="requested" required /></label>
        <label>Ofrecido <input name="offered" required /></label>
        <label>Proveedor <input name="supplier_name" /></label>
        <label>Costo unit <input name="unit_cost" type="number" step="0.01" /></label>
        <label><input type="checkbox" name="cost_verified" /> cost_verified</label>
        <label>Stock <input name="stock" type="number" /></label>
        <label><input type="checkbox" name="stock_verified" /> stock_verified</label>
        <button class="btn" type="submit">Clasificar EXACTO/EQUIVALENTE/NO MATCH</button>
      </form>
    </div>
    <div class="card" style="margin-top:.75rem;overflow:auto">
      <table><thead><tr><th>Nombre</th><th>Contacto</th><th>Verificado</th></tr></thead>
      <tbody>${(d.items||[]).map(s=>`<tr><td>${s.name}</td><td>${s.email||""} ${s.whatsapp||""}</td><td>${s.verified?"sí":"NO VERIFICADO"}</td></tr>`).join("")||`<tr><td colspan="3" class="muted">Sin proveedores</td></tr>`}</tbody></table>
    </div>`;
}

async function simpleList(title, path, formHtml, onMount) {
  const d = await api(path);
  return { html: `
    <div class="card">${formHtml || ""}</div>
    <div class="card" style="margin-top:.75rem;overflow:auto">
      <h3>${title}</h3>
      <pre class="muted" style="white-space:pre-wrap;font-size:.75rem">${JSON.stringify(d.items || d, null, 2)}</pre>
    </div>`, onMount };
}

async function viewCapital() {
  const d = await api("/api/capital");
  return `
    <div class="card">
      <h3>CAPITAL_OPERATIVO_REAL</h3>
      <div class="num">${d.capital_operativo_real == null ? '<span class="badge nv">NO VERIFICADO</span>' : money(d.capital_operativo_real)}</div>
      <p class="muted">${d.formula}</p>
      <form class="stack" id="capForm">
        <label>Caja <input name="caja" type="number" step="0.01" value="${d.components?.caja ?? d.snapshot?.caja ?? 0}" /></label>
        <label>CxC firmes <input name="cxc_firmes" type="number" step="0.01" value="${d.components?.cxc_firmes ?? d.snapshot?.cxc_firmes ?? 0}" /></label>
        <label>Deudas <input name="deudas" type="number" step="0.01" value="${d.components?.deudas ?? d.snapshot?.deudas ?? 0}" /></label>
        <label>Impuestos <input name="impuestos" type="number" step="0.01" value="${d.components?.impuestos ?? d.snapshot?.impuestos ?? 0}" /></label>
        <label>Compromisos compra <input name="compromisos_compra" type="number" step="0.01" value="${d.components?.compromisos_compra ?? d.snapshot?.compromisos_compra ?? 0}" /></label>
        <button class="btn" type="submit">Guardar snapshot</button>
      </form>
    </div>`;
}

async function render(id) {
  const app = document.getElementById("app");
  setActive(id);
  app.innerHTML = `<p class="muted">Cargando ${id}…</p>`;
  try {
    let html = "";
    if (id === "dashboard") html = await viewDashboard();
    else if (id === "hoy") html = await viewHoy();
    else if (id === "oportunidades") html = await viewOportunidades();
    else if (id === "proveedores") html = await viewProveedores();
    else if (id === "cotizaciones") {
      const x = await simpleList(
        "Cotizaciones",
        "/api/cotizaciones",
        `<h3>Nueva cotización</h3><form class="stack" id="cotForm">
          <label>Opp ID <input name="opportunity_id" type="number" required /></label>
          <label>Markup <input name="markup" type="number" step="0.01" value="1.9" /></label>
          <button class="btn" type="submit">Calcular (manual, sin auto-present)</button></form>`
      );
      html = x.html;
    } else if (id === "ops") {
      const d = await api("/api/ops-ganadas");
      html = `<div class="card"><h3>Ops ganadas</h3>
        <table><thead><tr><th>ID</th><th>Título</th><th>Utilidad</th><th>Links</th></tr></thead>
        <tbody>${(d.items||[]).map(o=>`<tr><td>${o.external_id}</td><td>${o.title}</td><td>${money(o.utilidad_estimada)}</td><td>${pliegoLinks(o)}</td></tr>`).join("")||`<tr><td colspan="4" class="muted">Ninguna</td></tr>`}</tbody></table></div>`;
    } else if (id === "compras") {
      const x = await simpleList("Compras", "/api/compras",
        `<h3>Registrar compra (manual)</h3><form class="stack" id="compraForm">
        <label>Opp ID <input name="opportunity_id" type="number" /></label>
        <label>Descripción <input name="description" /></label>
        <label>Monto <input name="amount" type="number" step="0.01" /></label>
        <button class="btn" type="submit">Guardar — sin auto-pay</button></form>`);
      html = x.html;
    } else if (id === "entregas") {
      const x = await simpleList("Entregas", "/api/entregas",
        `<h3>Entrega</h3><form class="stack" id="entForm">
        <label>Opp ID <input name="opportunity_id" type="number" /></label>
        <label>Destino <input name="destino" /></label>
        <label>Fecha <input name="scheduled_at" /></label>
        <button class="btn" type="submit">Guardar</button></form>`);
      html = x.html;
    } else if (id === "facturacion") {
      const x = await simpleList("Facturas", "/api/facturacion",
        `<h3>Factura</h3><form class="stack" id="facForm">
        <label>Opp ID <input name="opportunity_id" type="number" /></label>
        <label>Número <input name="numero" /></label>
        <label>Monto <input name="amount" type="number" step="0.01" /></label>
        <button class="btn" type="submit">Guardar</button></form>`);
      html = x.html;
    } else if (id === "cobranzas") {
      const d = await api("/api/cobranzas");
      html = `
        <div class="card"><h3>Nueva cobranza</h3>
          <form class="stack" id="cobForm">
            <label>Opp ID <input name="opportunity_id" type="number" /></label>
            <label>Monto <input name="amount" type="number" step="0.01" /></label>
            <label>Vence <input name="due_at" placeholder="ISO o DD/MM/YY" /></label>
            <label>Estado
              <select name="state"><option>PENDIENTE</option><option>PARCIAL</option><option>VENCIDA</option><option>EN_GESTION</option><option>COBRADA</option><option>INCOBRABLE</option></select>
            </label>
            <label><input type="checkbox" name="firmes" /> CxC firme</label>
            <button class="btn" type="submit">Guardar</button>
          </form>
        </div>
        <div class="card" style="margin-top:.75rem;overflow:auto">
          <table><thead><tr><th>ID</th><th>Estado</th><th>Monto</th><th>Vence</th><th>Alertas</th></tr></thead>
          <tbody>${(d.items||[]).map(c=>`<tr><td>${c.id}</td><td>${c.state}</td><td>${money(c.amount)}</td><td>${c.due_at||"—"}</td><td>${(c.alerts||[]).map(a=>`<span class="badge urgente">${a}</span>`).join(" ")}</td></tr>`).join("")||`<tr><td colspan="5" class="muted">Sin cobranzas</td></tr>`}</tbody></table>
        </div>`;
    } else if (id === "caja") {
      const d = await api("/api/caja");
      html = `
        <div class="card"><h3>Saldo caja</h3><div class="num">${money(d.saldo)}</div>
          <form class="stack" id="cajaForm">
            <label>Tipo <select name="tipo"><option>INGRESO</option><option>EGRESO</option><option>AJUSTE</option></select></label>
            <label>Monto <input name="amount" type="number" step="0.01" required /></label>
            <label>Concepto <input name="concept" /></label>
            <button class="btn" type="submit">Registrar</button>
          </form>
        </div>
        <div class="card" style="margin-top:.75rem"><pre class="muted" style="white-space:pre-wrap;font-size:.75rem">${JSON.stringify(d.movimientos,null,2)}</pre></div>`;
    } else if (id === "capital") html = await viewCapital();
    else if (id === "rentabilidad") {
      const d = await api("/api/rentabilidad");
      html = `<div class="card" style="overflow:auto"><h3>Ranking eficiencia de capital</h3>
        <table><thead><tr><th>#</th><th>Opp</th><th>Utilidad</th><th>Capital</th><th>Eff</th><th></th></tr></thead>
        <tbody>${(d.items||[]).map(r=>`<tr><td>${r.rank}</td><td>${r.title||r.id}</td><td>${money(r.utilidad_estimada)}</td><td>${money(r.capital_requerido)}</td><td>${r.efficiency==null?'<span class="badge nv">NO VERIFICADO</span>':(r.efficiency*100).toFixed(1)+'%'}</td><td>${r.label||""}</td></tr>`).join("")}</tbody></table></div>`;
    } else if (id === "alertas") {
      const d = await api("/api/alertas");
      html = `<div class="card"><ul class="tasks">${(d.items||[]).map(a=>`<li>
        <span class="badge ${a.level}">${a.level}</span> <strong>${a.title}</strong>
        <div class="muted">${a.body}</div>
        <button class="btn secondary" data-resolve="${a.id}">Resolver</button>
      </li>`).join("")||`<li class="muted">Sin alertas</li>`}</ul></div>`;
    } else if (id === "indicadores") {
      const d = await api("/api/indicadores");
      html = `<div class="card">
        <h3>Indicadores (ledger real)</h3>
        <p class="muted">${d.note}</p>
        <div>Ventas mes ${d.year_month}: ${money(d.ventas_ledger)} / meta ${money(d.meta_ventas)}</div>
        <div>Ganancia: ${money(d.ganancia_ledger)} / meta ${money(d.meta_ganancia)}</div>
        <div>Caja saldo: ${money(d.caja_saldo)} · CxC firmes: ${money(d.cxc_firmes)}</div>
        <pre class="muted" style="white-space:pre-wrap;font-size:.75rem;margin-top:.75rem">${JSON.stringify(d.oportunidades,null,2)}</pre>
      </div>`;
    } else if (id === "proyecciones") {
      const d = await api("/api/proyecciones");
      html = `<div class="card">
        <h3>Proyecciones · <span class="badge nv">${d.label}</span></h3>
        <p class="muted">${d.warning}</p>
        <table><thead><tr><th>Escenario</th><th>Ventas</th><th>Ganancia</th><th>% meta V</th><th>% meta G</th><th>Nota</th></tr></thead>
        <tbody>${(d.scenarios||[]).map(s=>`<tr>
          <td>${s.scenario}</td><td>${money(s.ventas)}</td><td>${money(s.ganancia)}</td>
          <td>${(s.vs_meta_ventas*100).toFixed(1)}%</td><td>${(s.vs_meta_ganancia*100).toFixed(1)}%</td>
          <td class="muted">${s.note}</td></tr>`).join("")}</tbody></table>
      </div>`;
    } else html = `<p>Módulo desconocido</p>`;

    app.innerHTML = html;
    wire(id);
  } catch (e) {
    app.innerHTML = `<div class="flash err">${e.message}</div>`;
  }
}

function wire(id) {
  const app = document.getElementById("app");

  app.querySelector("#ventasForm")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    await api("/api/ventas-mes", {
      method: "PUT",
      body: JSON.stringify({ ventas: Number(fd.get("ventas")), ganancia: Number(fd.get("ganancia")) }),
    });
    flash("Meta actualizada");
    render("dashboard");
  });

  app.querySelector("#btnNewOpp")?.addEventListener("click", () => {
    document.getElementById("oppForms").innerHTML = formNewOpp();
    document.getElementById("newOppForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = Object.fromEntries(fd.entries());
      if (body.fit_hint) body.fit_hint = Number(body.fit_hint);
      try {
        const r = await api("/api/oportunidades", { method: "POST", body: JSON.stringify(body) });
        flash(r.skipped ? r.reason : `Creada score ${r.mm_score?.total}`, !r.skipped);
        render("oportunidades");
      } catch (e) {
        flash(e.message, false);
      }
    };
  });

  app.querySelector("#btnImport")?.addEventListener("click", () => {
    document.getElementById("oppForms").innerHTML = formImport();
    document.getElementById("importForm").onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        const raw = new FormData(ev.target).get("json");
        const body = JSON.parse(String(raw));
        const r = await api("/api/import", { method: "POST", body: JSON.stringify(body) });
        flash(`Importadas ${r.imported}, hard-skip ${r.skipped_hard}`);
        render("oportunidades");
      } catch (e) {
        flash(e.message, false);
      }
    };
  });

  app.querySelectorAll("select[data-pipe]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      await api(`/api/oportunidades/${sel.dataset.pipe}`, {
        method: "PATCH",
        body: JSON.stringify({ pipeline: sel.value }),
      });
      flash(`Pipeline → ${sel.value}`);
    });
  });

  app.querySelectorAll("[data-detail]").forEach((btn) => {
    btn.addEventListener("click", () => showOppDetail(btn.dataset.detail));
  });

  app.querySelector("#supForm")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    await api("/api/proveedores", {
      method: "POST",
      body: JSON.stringify({
        name: fd.get("name"),
        email: fd.get("email"),
        whatsapp: fd.get("whatsapp"),
        verified: fd.get("verified") === "on",
      }),
    });
    flash("Proveedor guardado");
    render("proveedores");
  });

  app.querySelector("#matchForm")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const r = await api("/api/proveedores/match", {
      method: "POST",
      body: JSON.stringify({
        opportunity_id: fd.get("opportunity_id") ? Number(fd.get("opportunity_id")) : undefined,
        requested: fd.get("requested"),
        offered: fd.get("offered"),
        supplier_name: fd.get("supplier_name"),
        unit_cost: fd.get("unit_cost") ? Number(fd.get("unit_cost")) : null,
        cost_verified: fd.get("cost_verified") === "on",
        stock: fd.get("stock") ? Number(fd.get("stock")) : null,
        stock_verified: fd.get("stock_verified") === "on",
      }),
    });
    flash(`Match ${r.match_type}: ${r.why}`);
  });

  const postForm = (sel, path, map) => {
    app.querySelector(sel)?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = map(fd);
      await api(path, { method: "POST", body: JSON.stringify(body) });
      flash("Guardado");
      render(id);
    });
  };

  postForm("#cotForm", "/api/cotizaciones", (fd) => ({
    opportunity_id: Number(fd.get("opportunity_id")),
    markup: Number(fd.get("markup")),
  }));
  postForm("#compraForm", "/api/compras", (fd) => ({
    opportunity_id: fd.get("opportunity_id") ? Number(fd.get("opportunity_id")) : null,
    description: fd.get("description"),
    amount: fd.get("amount") ? Number(fd.get("amount")) : null,
  }));
  postForm("#entForm", "/api/entregas", (fd) => ({
    opportunity_id: fd.get("opportunity_id") ? Number(fd.get("opportunity_id")) : null,
    destino: fd.get("destino"),
    scheduled_at: fd.get("scheduled_at"),
  }));
  postForm("#facForm", "/api/facturacion", (fd) => ({
    opportunity_id: fd.get("opportunity_id") ? Number(fd.get("opportunity_id")) : null,
    numero: fd.get("numero"),
    amount: fd.get("amount") ? Number(fd.get("amount")) : null,
  }));
  postForm("#cobForm", "/api/cobranzas", (fd) => ({
    opportunity_id: fd.get("opportunity_id") ? Number(fd.get("opportunity_id")) : null,
    amount: fd.get("amount") ? Number(fd.get("amount")) : null,
    due_at: fd.get("due_at"),
    state: fd.get("state"),
    firmes: fd.get("firmes") === "on",
  }));
  postForm("#cajaForm", "/api/caja", (fd) => ({
    tipo: fd.get("tipo"),
    amount: Number(fd.get("amount")),
    concept: fd.get("concept"),
  }));
  postForm("#capForm", "/api/capital", (fd) => ({
    caja: Number(fd.get("caja")),
    cxc_firmes: Number(fd.get("cxc_firmes")),
    deudas: Number(fd.get("deudas")),
    impuestos: Number(fd.get("impuestos")),
    compromisos_compra: Number(fd.get("compromisos_compra")),
  }));

  app.querySelectorAll("[data-resolve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/alertas/${btn.dataset.resolve}/resolve`, { method: "POST" });
      render("alertas");
    });
  });
}

function initTabs() {
  const nav = document.getElementById("tabs");
  MODULES.forEach((m) => {
    const b = document.createElement("button");
    b.textContent = m.label;
    b.dataset.id = m.id;
    b.onclick = () => render(m.id);
    nav.appendChild(b);
  });
  const start = (location.hash || "#dashboard").replace("#", "");
  render(MODULES.some((m) => m.id === start) ? start : "dashboard");
}

initTabs();
