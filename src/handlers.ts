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

  return null;
}
