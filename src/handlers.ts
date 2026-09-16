import type { MiniDb } from "./db.js";
import {
  dashboard,
  queHagoHoy,
  listOportunidades,
  opportunityDetail,
  addOpportunityManual,
  cobranzasList,
  alertsList,
  projections,
  bottleneck,
  readCapital,
  refreshAllScores,
  syncAlerts,
} from "./services/state.js";
import { assertNoInventPolicy } from "./engines/invent.js";
import { MARKUP_DEFAULT } from "./constants.js";

export type EnvLike = {
  DB?: MiniDb;
  MARKUP_DEFAULT?: string;
  META_VENTAS_MENSUAL?: string;
  META_GANANCIA_MENSUAL?: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 0), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const t = await req.text();
    if (!t.trim()) return {};
    return JSON.parse(t) as Record<string, unknown>;
  }
  if (ct.includes("form")) {
    const fd = await req.formData();
    const o: Record<string, unknown> = {};
    fd.forEach((v, k) => {
      o[k] = String(v);
    });
    return o;
  }
  const t = await req.text();
  if (!t.trim()) return {};
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function handleApi(req: Request, db: MiniDb): Promise<Response | null> {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  if (p === "/api/health" && method === "GET") {
    return json({
      ok: true,
      app: "mm-radar",
      tz: "America/Argentina/Buenos_Aires",
      auto_buy: false,
      invent: assertNoInventPolicy(),
      markup_default: MARKUP_DEFAULT,
    });
  }

  if (p === "/api/hoy" && method === "GET") {
    return json(await dashboard(db));
  }

  if (p === "/api/que-hago-hoy" && method === "GET") {
    return json({ tasks: await queHagoHoy(db) });
  }

  if (p === "/api/oportunidades" && method === "GET") {
    return json({ oportunidades: await listOportunidades(db) });
  }

  if (p === "/api/oportunidades" && method === "POST") {
    const body = await parseBody(req);
    const res = await addOpportunityManual(db, {
      title: String(body.title || ""),
      source_url: String(body.source_url || body.url || ""),
      external_id: body.external_id ? String(body.external_id) : undefined,
      organism: body.organism ? String(body.organism) : undefined,
      rubros: body.rubros ? String(body.rubros) : undefined,
      cierre_at: body.cierre_at ? String(body.cierre_at) : undefined,
      pliego_url: body.pliego_url ? String(body.pliego_url) : undefined,
      bid_scope: body.bid_scope ? String(body.bid_scope) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
    });
    return json(res, res.ok ? 201 : 400);
  }

  const m = p.match(/^\/api\/oportunidades\/(\d+)$/);
  if (m && method === "GET") {
    const det = await opportunityDetail(db, Number(m[1]));
    if (!det) return json({ error: "no encontrada" }, 404);
    return json(det);
  }

  if (p === "/api/caja" && method === "GET") {
    const cap = await readCapital(db);
    const ledger = await db.all("SELECT * FROM cash_ledger ORDER BY id DESC LIMIT 100");
    return json({ ...cap, ledger, never_count_quotes_as_cash: true });
  }

  if (p === "/api/caja" && method === "POST") {
    const body = await parseBody(req);
    const tipo = String(body.tipo || "").toUpperCase();
    const amount = Number(body.amount);
    if (!["INGRESO", "EGRESO", "AJUSTE"].includes(tipo) || !Number.isFinite(amount)) {
      return json({ error: "tipo INGRESO|EGRESO|AJUSTE y amount numérico" }, 400);
    }
    await db.run(
      "INSERT INTO cash_ledger (tipo, amount, concept, notes, verified_at) VALUES (?,?,?,?, datetime('now'))",
      tipo,
      amount,
      String(body.concept || ""),
      String(body.notes || "")
    );
    return json(await readCapital(db), 201);
  }

  if (p === "/api/cobranzas" && method === "GET") {
    return json({ cobranzas: await cobranzasList(db) });
  }

  if (p === "/api/cobranzas" && method === "POST") {
    const body = await parseBody(req);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) return json({ error: "amount requerido" }, 400);
    const firmes = body.firmes === true || body.firmes === 1 || body.firmes === "1" ? 1 : 0;
    await db.run(
      `INSERT INTO collections (opportunity_id, amount, due_at, state, firmes, notes, verification, source_url, verified_at)
       VALUES (?,?,?,?,?,?,?,?, datetime('now'))`,
      body.opportunity_id ? Number(body.opportunity_id) : null,
      amount,
      String(body.due_at || ""),
      String(body.state || "PENDIENTE"),
      firmes,
      String(body.notes || ""),
      firmes ? "FIRMES" : "COBRO_ESTIMADO",
      String(body.source_url || "")
    );
    await syncAlerts(db);
    return json({ ok: true }, 201);
  }

  if (p === "/api/alertas" && method === "GET") {
    return json({ alertas: await alertsList(db) });
  }

  if (p === "/api/proyecciones" && method === "GET") {
    return json(await projections(db));
  }

  if (p === "/api/bottleneck" && method === "GET") {
    return json(await bottleneck(db));
  }

  if (p === "/api/refresh" && (method === "POST" || method === "GET")) {
    await refreshAllScores(db);
    await syncAlerts(db);
    return json({ ok: true });
  }

  if (p === "/api/policy" && method === "GET") {
    return json({
      ...assertNoInventPolicy(),
      hard_skip: ["16514"],
      markup_default: MARKUP_DEFAULT,
      auto_buy: false,
      auto_bid: false,
      labels: ["STOCK_NO_VERIFICADO", "PRECIO_NO_VERIFICADO", "COBRO_ESTIMADO"],
    });
  }

  if (p === "/api/import" && method === "POST") {
    const body = await parseBody(req);
    const { importPayload } = await import("./services/import.js");
    const res = await importPayload(db, body as never);
    return json(res, res.ok ? 200 : 400);
  }


  if (p === "/api/cotizaciones" && method === "GET") {
    const items = await db.all(
      `SELECT q.*, o.external_id, o.title AS opp_title
       FROM quotes q
       LEFT JOIN opportunities o ON o.id = q.opportunity_id
       ORDER BY q.id DESC LIMIT 200`
    );
    return json({
      cotizaciones: items,
      note: "Las cotizaciones NUNCA cuentan como caja. Sin auto-presentación.",
    });
  }

  if (p === "/api/cotizaciones" && method === "POST") {
    const body = await parseBody(req);
    const opportunity_id = Number(body.opportunity_id);
    if (!Number.isFinite(opportunity_id)) return json({ error: "opportunity_id requerido" }, 400);
    const markup = Number(body.markup) || MARKUP_DEFAULT;
    const items = await db.all<{ qty: number; unit_cost: number | null; cost_verified: number }>(
      "SELECT qty, unit_cost, cost_verified FROM opportunity_items WHERE opportunity_id = ?",
      opportunity_id
    );
    const { computeProfit } = await import("./engines/profit.js");
    const profit = computeProfit(
      items.map((it) => ({
        qty: Number(it.qty) || 1,
        unit_cost: it.unit_cost,
        cost_verified: Number(it.cost_verified) === 1,
      })),
      { markup }
    );
    await db.run(
      `INSERT INTO quotes (opportunity_id, markup, cost_products, cost_shipping, cost_other, cost_total, sell_price, gross, net_estimated, capital, days_locked, roi, capital_efficiency, status, notes, verification)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      opportunity_id,
      markup,
      profit.cost_products,
      profit.cost_shipping,
      profit.cost_other,
      profit.cost_total,
      profit.sell_price,
      profit.gross,
      profit.net_estimated,
      profit.capital,
      profit.days_locked,
      profit.roi,
      profit.capital_efficiency,
      String(body.status || "BORRADOR"),
      String(body.notes || ""),
      profit.verification
    );
    return json({ ok: true, profit, note: "Sin auto-presentación / auto-bid" }, 201);
  }

  if (p === "/api/indicadores" && method === "GET") {
    const hoy = await dashboard(db);
    const open = await db.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM opportunities WHERE skipped = 0 AND pipeline NOT IN ('DESCARTADA','PERDIDA','COBRADO','COBRADA','SKIPPED_HARD')"
    );
    const presentadas = await db.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM opportunities WHERE pipeline = 'PRESENTADA'"
    );
    const ganadas = await db.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM opportunities WHERE pipeline = 'OPS_GANADA'"
    );
    const alertas = await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM alerts WHERE resolved = 0");
    return json({
      capital_operativo_real: hoy.capital_operativo_real,
      caja: hoy.caja,
      por_cobrar: hoy.por_cobrar,
      libre: hoy.libre,
      metas: hoy.metas,
      pipeline_open: open?.n ?? 0,
      presentadas: presentadas?.n ?? 0,
      ops_ganadas: ganadas?.n ?? 0,
      alertas_abiertas: alertas?.n ?? 0,
      labels: hoy.labels,
      note: "Indicadores solo desde ledger/DB real — ceros si vacío. No inventa.",
    });
  }

  if (p === "/api/backup" && method === "POST") {
    const body = await parseBody(req);
    const counts: Record<string, number> = {};
    for (const t of ["opportunities", "quotes", "cash_ledger", "collections", "alerts"]) {
      const row = await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
      counts[t] = Number(row?.n || 0);
    }
    const res = await db.run(
      `INSERT INTO backups (kind, label, path_or_url, row_counts_json, note) VALUES (?,?,?,?,?)`,
      String(body.kind || "manual"),
      String(body.label || "snapshot"),
      String(body.path_or_url || ""),
      JSON.stringify(counts),
      String(body.note || "metadata only — export vía /api/backup/json si disponible")
    );
    return json({ ok: true, id: res.lastId, counts }, 201);
  }

  if (p === "/api/backup" && method === "GET") {
    const items = await db.all("SELECT * FROM backups ORDER BY id DESC LIMIT 50");
    return json({ backups: items });
  }

  return null;
}
