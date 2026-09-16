import type { Db } from "./db.js";
import {
  MARKUP_DEFAULT,
  META_VENTAS_MENSUAL,
  META_GANANCIA_MENSUAL,
  PIPELINE,
  LABEL_NO_VERIFICADO,
} from "./constants.js";
import { isHardSkipped, hardSkipReason } from "./engines/hardskip.js";
import { inventFlags, sanitizeOpportunityDisplay, assertNoInventPolicy } from "./engines/invent.js";
import { classifyMatch, stockVerifiedFlag } from "./engines/match.js";
import { computeMmScore } from "./engines/score.js";
import { computeCapitalOperativoReal } from "./engines/capital.js";
import { computeProfit, rankByCapitalEfficiency } from "./engines/profit.js";
import { buildQueHagoHoy, type RawSignal } from "./engines/tasks.js";
import { hoursUntil, currentYearMonth } from "./time.js";
import { projectScenarios } from "./engines/projections.js";

export type EnvConfig = {
  markup: number;
  metaVentas: number;
  metaGanancia: number;
};

export function envFromVars(vars?: Record<string, string | undefined>): EnvConfig {
  return {
    markup: parseFloat(vars?.MARKUP_DEFAULT || "") || MARKUP_DEFAULT,
    metaVentas: parseFloat(vars?.META_VENTAS_MENSUAL || "") || META_VENTAS_MENSUAL,
    metaGanancia: parseFloat(vars?.META_GANANCIA_MENSUAL || "") || META_GANANCIA_MENSUAL,
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

async function getSetting(db: Db, key: string, fallback: string): Promise<string> {
  const row = await db.prepare("SELECT value FROM config WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? fallback;
}

async function getMarkup(db: Db, cfg: EnvConfig): Promise<number> {
  const v = await getSetting(db, "markup_default", String(cfg.markup));
  return parseFloat(v) || cfg.markup;
}

function recomputeScoreForRow(row: Record<string, unknown>, _hours: number | null) {
  return computeMmScore({
    fit_hint: row.fit_hint as number | null,
    rubros: (row.rubros as string) || "",
    margin_ratio: row.margin_ratio as number | null,
    has_verified_cost: row.cost_total != null && row.verification === "VERIFICADO",
    capital_requerido: (row.capital_requerido as number | null) ?? (row.cost_total as number | null),
    match_type: (row.match_type as any) || null,
    stock_verified: Boolean(row.stock_verified),
    avoided_category: Boolean(row.skipped) === false ? undefined : undefined,
  });
}

async function refreshOpportunityScore(db: Db, id: number): Promise<void> {
  const row = await db
    .prepare("SELECT * FROM opportunities WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return;
  const hours = hoursUntil(String(row.cierre_at || row.apertura_at || ""));
  const score = recomputeScoreForRow(row, hours);
  await db
    .prepare(
      "UPDATE opportunities SET mm_score = ?, mm_score_json = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .bind(score.total, JSON.stringify(score), id)
    .run();
}

export async function handleApi(
  req: Request,
  db: Db,
  cfg: EnvConfig
): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (method === "OPTIONS") {
    return json({ ok: true });
  }

  // —— Health / policy ——
  if (path === "/api/health" && method === "GET") {
    return json({
      ok: true,
      app: "mm-radar",
      policy: assertNoInventPolicy(),
      pipeline: PIPELINE,
      meta: { ventas: cfg.metaVentas, ganancia: cfg.metaGanancia },
    });
  }

  // —— Settings ——
  if (path === "/api/settings" && method === "GET") {
    const { results } = await db.prepare("SELECT key, value FROM config").all();
    const map: Record<string, string> = {};
    for (const r of results || []) map[String(r.key)] = String(r.value);
    return json(map);
  }

  if (path === "/api/settings" && method === "PUT") {
    const body = await readJson(req);
    if (!body || typeof body !== "object") return json({ error: "JSON inválido" }, 400);
    for (const [k, v] of Object.entries(body)) {
      await db
        .prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(k, String(v))
        .run();
    }
    return json({ ok: true });
  }

  // —— Dashboard HOY ——
  if (path === "/api/dashboard" && method === "GET") {
    const ym = currentYearMonth();
    const ventasRow = await db
      .prepare("SELECT * FROM ventas_mes WHERE year_month = ?")
      .bind(ym)
      .first<{ ventas: number; ganancia: number }>();
    const ventas = ventasRow?.ventas ?? 0;
    const ganancia = ventasRow?.ganancia ?? 0;
    const metaV = parseFloat(await getSetting(db, "meta_ventas_mensual", String(cfg.metaVentas))) || cfg.metaVentas;
    const metaG =
      parseFloat(await getSetting(db, "meta_ganancia_mensual", String(cfg.metaGanancia))) ||
      cfg.metaGanancia;

    const oppCount = await db
      .prepare("SELECT COUNT(*) as c FROM opportunities WHERE skipped = 0")
      .first<{ c: number }>();
    const hot = await db
      .prepare(
        "SELECT COUNT(*) as c FROM opportunities WHERE skipped = 0 AND mm_score >= 60 AND pipeline NOT IN ('DESCARTADA','PERDIDA','COBRADO','COBRADA','SKIPPED_HARD')"
      )
      .first<{ c: number }>();
    const presentadas = await db
      .prepare("SELECT COUNT(*) as c FROM opportunities WHERE pipeline = 'PRESENTADA'")
      .first<{ c: number }>();
    const ganadas = await db
      .prepare("SELECT COUNT(*) as c FROM opportunities WHERE pipeline = 'OPS_GANADA'")
      .first<{ c: number }>();
    const alertas = await db
      .prepare("SELECT COUNT(*) as c FROM alertas WHERE resolved = 0")
      .first<{ c: number }>();

    const cap = await db
      .prepare("SELECT * FROM capital_snapshot ORDER BY id DESC LIMIT 1")
      .first<Record<string, unknown>>();

    let capital = null;
    if (cap) {
      capital = computeCapitalOperativoReal({
        caja: Number(cap.caja) || 0,
        cxc_firmes: Number(cap.cxc_firmes) || 0,
        deudas: Number(cap.deudas) || 0,
        impuestos: Number(cap.impuestos) || 0,
        compromisos_compra: Number(cap.compromisos ?? cap.compromisos_compra) || 0,
      });
    }

    return json({
      hoy: {
        oportunidades_activas: oppCount?.c ?? 0,
        score_alto: hot?.c ?? 0,
        presentadas: presentadas?.c ?? 0,
        ops_ganadas: ganadas?.c ?? 0,
        alertas_abiertas: alertas?.c ?? 0,
      },
      meta: {
        year_month: ym,
        ventas,
        ganancia,
        meta_ventas: metaV,
        meta_ganancia: metaG,
        progreso_ventas_pct: metaV ? Math.round((ventas / metaV) * 1000) / 10 : 0,
        progreso_ganancia_pct: metaG ? Math.round((ganancia / metaG) * 1000) / 10 : 0,
      },
      capital,
      policy: assertNoInventPolicy(),
    });
  }

  if (path === "/api/ventas-mes" && method === "PUT") {
    const body = await readJson(req);
    const ym = body?.year_month || currentYearMonth();
    const ventas = Number(body?.ventas) || 0;
    const ganancia = Number(body?.ganancia) || 0;
    await db
      .prepare(
        `INSERT INTO ventas_mes (year_month, ventas, ganancia, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(year_month) DO UPDATE SET ventas=excluded.ventas, ganancia=excluded.ganancia, updated_at=datetime('now')`
      )
      .bind(ym, ventas, ganancia)
      .run();
    return json({ ok: true, year_month: ym, ventas, ganancia });
  }

  // —— Qué hago hoy ——
  if (path === "/api/que-hago-hoy" && method === "GET") {
    const { results: opps } = await db
      .prepare(
        "SELECT * FROM opportunities WHERE skipped = 0 AND pipeline NOT IN ('DESCARTADA','PERDIDA','COBRADO','COBRADA','SKIPPED_HARD')"
      )
      .all<Record<string, unknown>>();
    const { results: cobranzas } = await db
      .prepare("SELECT * FROM cobranzas WHERE state NOT IN ('COBRADA','INCOBRABLE')")
      .all<Record<string, unknown>>();
    const { results: entregas } = await db
      .prepare("SELECT * FROM entregas WHERE status = 'PENDIENTE'")
      .all<Record<string, unknown>>();
    const { results: facturas } = await db
      .prepare("SELECT * FROM facturas WHERE status = 'PENDIENTE'")
      .all<Record<string, unknown>>();
    const cap = await db
      .prepare("SELECT * FROM capital_snapshot ORDER BY id DESC LIMIT 1")
      .first<Record<string, unknown>>();

    const signals: RawSignal[] = [];
    for (const o of opps || []) {
      const hours = hoursUntil(String(o.cierre_at || o.apertura_at || ""));
      signals.push({
        kind: "cierre",
        id: String(o.id),
        title: String(o.title),
        hours_to_event: hours,
        mm_score: o.mm_score as number,
        pipeline: String(o.pipeline),
      });
      signals.push({
        kind: "oportunidad",
        id: String(o.id),
        title: String(o.title),
        mm_score: o.mm_score as number,
        pipeline: String(o.pipeline),
      });
      if (o.pipeline === "OPS_GANADA") {
        signals.push({
          kind: "compra",
          id: String(o.id),
          title: String(o.title),
          pipeline: "OPS_GANADA",
        });
      }
    }
    for (const c of cobranzas || []) {
      signals.push({
        kind: "cobranza",
        id: String(c.id),
        title: `Cobranza #${c.id}`,
        hours_to_event: hoursUntil(String(c.due_at || "")),
        amount: c.amount as number,
        extra: `Estado ${c.state}`,
      });
    }
    for (const e of entregas || []) {
      signals.push({
        kind: "entrega",
        id: String(e.id),
        title: String(e.destino || `Entrega #${e.id}`),
        extra: String(e.scheduled_at || ""),
      });
    }
    for (const f of facturas || []) {
      signals.push({
        kind: "facturacion",
        id: String(f.id),
        title: String(f.numero || `Factura #${f.id}`),
      });
    }
    if (cap) {
      const c = computeCapitalOperativoReal({
        caja: Number(cap.caja) || 0,
        cxc_firmes: Number(cap.cxc_firmes) || 0,
        deudas: Number(cap.deudas) || 0,
        impuestos: Number(cap.impuestos) || 0,
        compromisos_compra: Number(cap.compromisos ?? cap.compromisos_compra) || 0,
      });
      if (c.capital_operativo_real < 0) {
        signals.push({
          kind: "capital",
          id: "capital",
          title: "Capital operativo",
          amount: c.capital_operativo_real,
        });
      }
    }

    const tasks = buildQueHagoHoy(signals);
    return json({
      generated_at: new Date().toISOString(),
      counts: {
        urgente: tasks.filter((t) => t.priority === "urgente").length,
        alta: tasks.filter((t) => t.priority === "alta").length,
        oportunidades: tasks.filter((t) => t.priority === "oportunidades").length,
      },
      tasks,
      note: "Sin auto-buy / auto-present / auto-pay. Acciones manuales.",
    });
  }

  // —— Opportunities list ——
  if (path === "/api/oportunidades" && method === "GET") {
    const pipeline = url.searchParams.get("pipeline");
    let sql = "SELECT * FROM opportunities WHERE 1=1";
    const binds: (string | number)[] = [];
    if (pipeline) {
      sql += " AND pipeline = ?";
      binds.push(pipeline);
    }
    if (url.searchParams.get("include_skipped") !== "1") {
      sql += " AND skipped = 0";
    }
    sql += " ORDER BY COALESCE(mm_score, -1) DESC, id DESC LIMIT 500";
    const stmt = db.prepare(sql);
    const { results } = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
    const items = (results || []).map((r) => {
      const display = sanitizeOpportunityDisplay(r as Record<string, unknown>);
      const hasPliego = Boolean(display.pliego_url || display.pliego_file);
      return {
        ...display,
        link_oportunidad: display.url || null,
        descargar_pliego: hasPliego
          ? { url: display.pliego_url || null, file: display.pliego_file || null }
          : null,
      };
    });
    return json({ count: items.length, items });
  }

  // —— Create opportunity (manual) ——
  if (path === "/api/oportunidades" && method === "POST") {
    const body = await readJson(req);
    if (!body) return json({ error: "JSON inválido" }, 400);
    const external_id = String(body.external_id || body.id || "").trim();
    if (!external_id) return json({ error: "external_id requerido" }, 400);
    if (isHardSkipped(external_id)) {
      await db
        .prepare(
          `INSERT INTO opportunities (external_id, source, title, skipped, skip_reason, pipeline, verification)
           VALUES (?, ?, ?, 1, ?, 'SKIPPED_HARD', ?)
           ON CONFLICT(external_id) DO UPDATE SET skipped=1, skip_reason=excluded.skip_reason, pipeline='SKIPPED_HARD'`
        )
        .bind(
          external_id,
          body.source || "MANUAL",
          body.title || "",
          hardSkipReason(external_id),
          LABEL_NO_VERIFICADO
        )
        .run();
      return json({ ok: false, skipped: true, reason: hardSkipReason(external_id) }, 422);
    }

    const markup = body.markup != null ? Number(body.markup) : await getMarkup(db, cfg);
    const items = Array.isArray(body.items) ? body.items : [];
    const profit = computeProfit(
      items.map((it: any) => ({
        qty: Number(it.qty) || 1,
        unit_cost: it.unit_cost != null ? Number(it.unit_cost) : null,
        cost_verified: Boolean(it.cost_verified),
      })),
      markup
    );

    const hours = hoursUntil(body.cierre_at || body.apertura_at || "");
    const score = computeMmScore({
      fit_hint: body.fit_hint != null ? Number(body.fit_hint) : null,
      margin_ratio: profit.margin_ratio,
      capital_requerido: profit.cost_total,
      match_type: body.match_type || null,
      stock_verified: Boolean(body.stock_verified),
      has_verified_cost: profit.verification === "VERIFICADO",
      rubros: body.rubros || "",
      avoided_category: Boolean(body.avoided_category),
    });

    await db
      .prepare(
        `INSERT INTO opportunities (
          external_id, source, title, organism, rubros, modality, numero, url,
          pliego_url, pliego_file, apertura_at, cierre_at, publicacion_at, timing_state,
          pipeline, fit_hint, mm_score, mm_score_json, risk_level,
          cost_total, precio_objetivo, utilidad_estimada, capital_requerido, margin_ratio,
          verification, match_type, stock_verified, notes, raw_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(external_id) DO UPDATE SET
          title=excluded.title, organism=excluded.organism, rubros=excluded.rubros,
          url=excluded.url, pliego_url=excluded.pliego_url, pliego_file=excluded.pliego_file,
          apertura_at=excluded.apertura_at, cierre_at=excluded.cierre_at,
          fit_hint=excluded.fit_hint, mm_score=excluded.mm_score, mm_score_json=excluded.mm_score_json,
          cost_total=excluded.cost_total, precio_objetivo=excluded.precio_objetivo,
          utilidad_estimada=excluded.utilidad_estimada, capital_requerido=excluded.capital_requerido,
          margin_ratio=excluded.margin_ratio, verification=excluded.verification,
          raw_json=excluded.raw_json, updated_at=datetime('now')`
      )
      .bind(
        external_id,
        body.source || "MANUAL",
        body.title || "",
        body.organism || "",
        body.rubros || "",
        body.modality || "",
        body.numero || "",
        body.url || "",
        body.pliego_url || "",
        body.pliego_file || "",
        body.apertura_at || "",
        body.cierre_at || body.apertura_at || "",
        body.publicacion_at || "",
        body.timing_state || LABEL_NO_VERIFICADO,
        body.pipeline || "DETECTADA",
        body.fit_hint != null ? Number(body.fit_hint) : null,
        score.total,
        JSON.stringify(score),
        body.risk_level || "",
        profit.cost_total,
        profit.precio_objetivo,
        profit.utilidad_estimada,
        profit.cost_total,
        profit.margin_ratio,
        profit.verification,
        body.match_type || "",
        body.stock_verified ? 1 : 0,
        body.notes || "",
        JSON.stringify(body)
      )
      .run();

    const row = await db
      .prepare("SELECT id FROM opportunities WHERE external_id = ?")
      .bind(external_id)
      .first<{ id: number }>();

    if (row && items.length) {
      await db.prepare("DELETE FROM opportunity_items WHERE opportunity_id = ?").bind(row.id).run();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await db
          .prepare(
            `INSERT INTO opportunity_items (opportunity_id, line_no, description, qty, unit, brand, model, unit_cost, cost_verified, verification)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          )
          .bind(
            row.id,
            it.line_no || i + 1,
            it.description || it.product || "",
            Number(it.qty) || 1,
            it.unit || "u",
            it.brand || "",
            it.model || "",
            it.unit_cost != null ? Number(it.unit_cost) : null,
            it.cost_verified ? 1 : 0,
            it.verification || (it.cost_verified ? "VERIFICADO" : LABEL_NO_VERIFICADO)
          )
          .run();
      }
    }

    return json({
      ok: true,
      id: row?.id,
      external_id,
      mm_score: score,
      profit,
      invent_flags: inventFlags({
        unit_cost: profit.cost_total,
        cost_verified: profit.verification === "VERIFICADO",
      }),
    });
  }

  // —— Opportunity detail ——
  const oppMatch = path.match(/^\/api\/oportunidades\/(\d+)$/);
  if (oppMatch && method === "GET") {
    const id = Number(oppMatch[1]);
    const row = await db.prepare("SELECT * FROM opportunities WHERE id = ?").bind(id).first();
    if (!row) return json({ error: "no encontrada" }, 404);
    const { results: items } = await db
      .prepare("SELECT * FROM opportunity_items WHERE opportunity_id = ? ORDER BY line_no")
      .bind(id)
      .all();
    const { results: matches } = await db
      .prepare("SELECT * FROM supplier_matches WHERE opportunity_id = ?")
      .bind(id)
      .all();
    const display = sanitizeOpportunityDisplay(row as Record<string, unknown>);
    const scoreJson = (() => {
      try {
        return JSON.parse(String(row.mm_score_json || "{}"));
      } catch {
        return {};
      }
    })();
    return json({
      ...display,
      link_oportunidad: display.url || null,
      descargar_pliego:
        display.pliego_url || display.pliego_file
          ? { url: display.pliego_url || null, file: display.pliego_file || null }
          : null,
      mm_score_breakdown: scoreJson,
      items: items || [],
      supplier_matches: matches || [],
    });
  }

  if (oppMatch && method === "PATCH") {
    const id = Number(oppMatch[1]);
    const body = await readJson(req);
    if (!body) return json({ error: "JSON inválido" }, 400);
    if (body.pipeline && !(PIPELINE as readonly string[]).includes(body.pipeline)) {
      return json({ error: "pipeline inválido", allowed: PIPELINE }, 400);
    }
    const fields: string[] = [];
    const vals: SqlVal[] = [];
    const allowed = [
      "pipeline",
      "notes",
      "risk_level",
      "pliego_url",
      "pliego_file",
      "url",
      "cierre_at",
      "apertura_at",
      "match_type",
      "stock_verified",
      "timing_state",
    ];
    for (const k of allowed) {
      if (body[k] !== undefined) {
        fields.push(`${k} = ?`);
        vals.push(k === "stock_verified" ? (body[k] ? 1 : 0) : body[k]);
      }
    }
    if (!fields.length) return json({ error: "sin campos" }, 400);
    fields.push("updated_at = datetime('now')");
    vals.push(id);
    await db
      .prepare(`UPDATE opportunities SET ${fields.join(", ")} WHERE id = ?`)
      .bind(...vals)
      .run();
    await refreshOpportunityScore(db, id);
    return json({ ok: true });
  }

  // —— Import JSON ——
  if (path === "/api/import" && method === "POST") {
    const body = await readJson(req);
    if (!body) return json({ error: "JSON inválido" }, 400);
    const list = Array.isArray(body) ? body : body.opportunities || body.items || body.tenders || [];
    if (!Array.isArray(list)) return json({ error: "se espera array u objeto con opportunities" }, 400);

    const markup = await getMarkup(db, cfg);
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const raw of list) {
      const external_id = String(raw.external_id || raw.id || raw.opportunity_id || "").trim();
      if (!external_id) {
        errors.push("fila sin id");
        continue;
      }
      if (isHardSkipped(external_id)) {
        skipped++;
        await db
          .prepare(
            `INSERT INTO opportunities (external_id, source, title, skipped, skip_reason, pipeline, verification, raw_json)
             VALUES (?, ?, ?, 1, ?, 'SKIPPED_HARD', ?, ?)
             ON CONFLICT(external_id) DO UPDATE SET skipped=1, skip_reason=excluded.skip_reason, pipeline='SKIPPED_HARD'`
          )
          .bind(
            external_id,
            raw.source || "CODINEU",
            raw.title || raw.titulo || "",
            hardSkipReason(external_id),
            LABEL_NO_VERIFICADO,
            JSON.stringify(raw)
          )
          .run();
        continue;
      }

      const items = raw.items || raw.line_items || [];
      const profit = computeProfit(
        (Array.isArray(items) ? items : []).map((it: any) => ({
          qty: Number(it.qty) || 1,
          unit_cost:
            it.unit_cost != null
              ? Number(it.unit_cost)
              : it.cost != null
                ? Number(it.cost)
                : null,
          cost_verified: Boolean(it.cost_verified || it.verification === "VERIFICADO"),
        })),
        Number(raw.margin_multiplier || raw.markup || markup)
      );

      // Si viene cost_total/precio ya verificados del export commerce
      let cost_total = profit.cost_total;
      let precio_objetivo = profit.precio_objetivo;
      let utilidad = profit.utilidad_estimada;
      let margin_ratio = profit.margin_ratio;
      let verification = profit.verification;

      if (raw.cost_total != null && (raw.cost_verified || raw.approval_status === "APROBADO")) {
        cost_total = Number(raw.cost_total);
        precio_objetivo =
          raw.precio_objetivo != null
            ? Number(raw.precio_objetivo)
            : cost_total * Number(raw.margin_multiplier || markup);
        utilidad = precio_objetivo - cost_total;
        margin_ratio = precio_objetivo > 0 ? utilidad / precio_objetivo : 0;
        verification = "VERIFICADO";
      } else if (raw.cost_total != null && !raw.cost_verified) {
        // presente pero no verificado → NO inventamos como cierto
        cost_total = null;
        precio_objetivo = null;
        utilidad = null;
        margin_ratio = null;
        verification = LABEL_NO_VERIFICADO;
      }

      const hours = hoursUntil(raw.cierre_at || raw.apertura || raw.apertura_at || raw.opening_at || "");
      const score = computeMmScore({
        fit_hint: raw.fit_score ?? raw.fit_hint ?? null,
        margin_ratio,
        capital_requerido: cost_total,
        match_type: raw.match_type || null,
        stock_verified: Boolean(raw.stock_verified),
        has_verified_cost: verification === "VERIFICADO",
        rubros: raw.rubros || "",
      });

      await db
        .prepare(
          `INSERT INTO opportunities (
            external_id, source, title, organism, rubros, modality, numero, url,
            pliego_url, pliego_file, apertura_at, cierre_at, pipeline, fit_hint,
            mm_score, mm_score_json, risk_level, cost_total, precio_objetivo,
            utilidad_estimada, capital_requerido, margin_ratio, verification,
            match_type, stock_verified, raw_json
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(external_id) DO UPDATE SET
            title=excluded.title, organism=excluded.organism, rubros=excluded.rubros,
            url=excluded.url, pliego_url=excluded.pliego_url, pliego_file=excluded.pliego_file,
            apertura_at=excluded.apertura_at, cierre_at=excluded.cierre_at,
            fit_hint=excluded.fit_hint, mm_score=excluded.mm_score, mm_score_json=excluded.mm_score_json,
            risk_level=excluded.risk_level, cost_total=excluded.cost_total,
            precio_objetivo=excluded.precio_objetivo, utilidad_estimada=excluded.utilidad_estimada,
            capital_requerido=excluded.capital_requerido, margin_ratio=excluded.margin_ratio,
            verification=excluded.verification, raw_json=excluded.raw_json, updated_at=datetime('now')`
        )
        .bind(
          external_id,
          raw.source || "CODINEU",
          raw.title || raw.titulo || "",
          raw.organism || raw.organismo || "",
          raw.rubros || "",
          raw.modality || raw.modalidad || "",
          raw.numero || "",
          raw.url || "",
          raw.pliego_url || "",
          raw.pliego_file || raw.tender_doc || "",
          raw.apertura_at || raw.apertura || raw.opening_at || "",
          raw.cierre_at || raw.apertura_at || raw.apertura || "",
          raw.pipeline || "DETECTADA",
          raw.fit_score ?? raw.fit_hint ?? null,
          score.total,
          JSON.stringify(score),
          raw.risk_level || "",
          cost_total,
          precio_objetivo,
          utilidad,
          cost_total,
          margin_ratio,
          verification,
          raw.match_type || "",
          raw.stock_verified ? 1 : 0,
          JSON.stringify(raw)
        )
        .run();
      imported++;
    }

    return json({ ok: true, imported, skipped_hard: skipped, errors });
  }

  // —— Suppliers ——
  if (path === "/api/proveedores" && method === "GET") {
    const { results } = await db.prepare("SELECT * FROM suppliers ORDER BY name").all();
    return json({ items: results || [] });
  }

  if (path === "/api/proveedores" && method === "POST") {
    const body = await readJson(req);
    if (!body?.name) return json({ error: "name requerido" }, 400);
    await db
      .prepare(
        `INSERT INTO suppliers (name, razon_social, web, email, whatsapp, telefono, notes, verified)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(name) DO UPDATE SET web=excluded.web, email=excluded.email, whatsapp=excluded.whatsapp,
           telefono=excluded.telefono, notes=excluded.notes, verified=excluded.verified`
      )
      .bind(
        body.name,
        body.razon_social || "",
        body.web || "",
        body.email || "",
        body.whatsapp || "",
        body.telefono || "",
        body.notes || "",
        body.verified ? 1 : 0
      )
      .run();
    return json({ ok: true });
  }

  if (path === "/api/proveedores/match" && method === "POST") {
    const body = await readJson(req);
    if (!body?.requested || !body?.offered) return json({ error: "requested/offered requeridos" }, 400);
    const match = classifyMatch({
      requested: body.requested,
      offered: body.offered,
      brandRequested: body.brand_requested,
      brandOffered: body.brand_offered,
      modelRequested: body.model_requested,
      modelOffered: body.model_offered,
    });
    const stock = stockVerifiedFlag(body.stock, Boolean(body.stock_verified));
    const flags = inventFlags({
      unit_cost: body.unit_cost,
      stock: body.stock,
      supplier_name: body.supplier_name,
      cost_verified: Boolean(body.cost_verified),
      stock_verified: Boolean(body.stock_verified),
      supplier_verified: Boolean(body.supplier_verified),
    });

    if (body.opportunity_id) {
      await db
        .prepare(
          `INSERT INTO supplier_matches (
            opportunity_id, item_id, supplier_name, product_label, match_type,
            unit_cost, stock, stock_verified, cost_verified, why, verification
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(
          Number(body.opportunity_id),
          body.item_id != null ? Number(body.item_id) : null,
          body.supplier_name || "",
          body.offered,
          match.match_type,
          body.unit_cost != null && body.cost_verified ? Number(body.unit_cost) : null,
          stock.stock,
          stock.stock_verified ? 1 : 0,
          body.cost_verified ? 1 : 0,
          match.why,
          flags.length ? LABEL_NO_VERIFICADO : "VERIFICADO"
        )
        .run();
      if (body.opportunity_id) {
        await db
          .prepare("UPDATE opportunities SET match_type = ?, stock_verified = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(match.match_type, stock.stock_verified ? 1 : 0, Number(body.opportunity_id))
          .run();
        await refreshOpportunityScore(db, Number(body.opportunity_id));
      }
    }

    return json({ ...match, ...stock, invent_flags: flags });
  }

  // —— Cotizaciones ——
  if (path === "/api/cotizaciones" && method === "GET") {
    const { results } = await db
      .prepare(
        `SELECT c.*, o.external_id, o.title FROM cotizaciones c
         LEFT JOIN opportunities o ON o.id = c.opportunity_id ORDER BY c.id DESC`
      )
      .all();
    return json({ items: results || [] });
  }

  if (path === "/api/cotizaciones" && method === "POST") {
    const body = await readJson(req);
    if (!body?.opportunity_id) return json({ error: "opportunity_id requerido" }, 400);
    const markup = body.markup != null ? Number(body.markup) : await getMarkup(db, cfg);
    const { results: items } = await db
      .prepare("SELECT * FROM opportunity_items WHERE opportunity_id = ?")
      .bind(Number(body.opportunity_id))
      .all<any>();
    const profit = computeProfit(
      (items || []).map((it) => ({
        qty: Number(it.qty) || 1,
        unit_cost: it.unit_cost,
        cost_verified: Boolean(it.cost_verified),
      })),
      markup
    );
    await db
      .prepare(
        `INSERT INTO quotes (opportunity_id, markup, cost_products, cost_shipping, cost_other, cost_total, sell_price, gross, net_estimated, capital, days_locked, roi, capital_efficiency, status, notes, verification)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        Number(body.opportunity_id),
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
        body.status || "BORRADOR",
        body.notes || "",
        profit.verification
      )
      .run();
    return json({ ok: true, profit, note: "Sin auto-presentación" });
  }

  // —— Ops ganadas / compras / entregas / facturas / cobranzas ——
  if (path === "/api/ops-ganadas" && method === "GET") {
    const { results } = await db
      .prepare("SELECT * FROM opportunities WHERE pipeline = 'OPS_GANADA' ORDER BY id DESC")
      .all();
    return json({ items: results || [] });
  }

  async function listTable(table: string) {
    const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all();
    return json({ items: results || [] });
  }

  if (path === "/api/compras" && method === "GET") return listTable("compras");
  if (path === "/api/compras" && method === "POST") {
    const body = await readJson(req);
    await db
      .prepare(
        `INSERT INTO purchases (opportunity_id, supplier_id, description, amount, status, committed_at, notes, verification)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .bind(
        body?.opportunity_id ?? null,
        body?.supplier_id ?? null,
        body?.description || "",
        body?.amount != null ? Number(body.amount) : null,
        body?.status || "PENDIENTE",
        body?.committed_at || "",
        body?.notes || "",
        body?.verification || LABEL_NO_VERIFICADO
      )
      .run();
    return json({ ok: true, note: "Sin auto-buy / auto-pay" });
  }

  if (path === "/api/entregas" && method === "GET") return listTable("entregas");
  if (path === "/api/entregas" && method === "POST") {
    const body = await readJson(req);
    await db
      .prepare(
        `INSERT INTO deliveries (opportunity_id, destino, scheduled_at, status, notes) VALUES (?,?,?,?,?)`
      )
      .bind(
        body?.opportunity_id ?? null,
        body?.destino || "",
        body?.scheduled_at || "",
        body?.status || "PENDIENTE",
        body?.notes || ""
      )
      .run();
    return json({ ok: true });
  }

  if (path === "/api/facturacion" && method === "GET") return listTable("facturas");
  if (path === "/api/facturacion" && method === "POST") {
    const body = await readJson(req);
    await db
      .prepare(
        `INSERT INTO invoices (opportunity_id, numero, amount, issued_at, status, notes) VALUES (?,?,?,?,?,?)`
      )
      .bind(
        body?.opportunity_id ?? null,
        body?.numero || "",
        body?.amount != null ? Number(body.amount) : null,
        body?.issued_at || "",
        body?.status || "PENDIENTE",
        body?.notes || ""
      )
      .run();
    return json({ ok: true });
  }

  if (path === "/api/cobranzas" && method === "GET") {
    const { results } = await db.prepare("SELECT * FROM cobranzas ORDER BY id DESC").all();
    const now = new Date();
    const enriched = (results || []).map((c: any) => {
      const h = hoursUntil(c.due_at, now);
      const alerts: string[] = [];
      if (c.state !== "COBRADA" && c.state !== "INCOBRABLE" && h != null) {
        if (h <= 24) alerts.push("CIERRE_COBRANZA_<24h");
        else if (h <= 72) alerts.push("CIERRE_COBRANZA_<72h");
        if (h < 0) alerts.push("VENCIDA");
      }
      return { ...c, hours_to_due: h, alerts };
    });
    return json({ items: enriched });
  }

  if (path === "/api/cobranzas" && method === "POST") {
    const body = await readJson(req);
    await db
      .prepare(
        `INSERT INTO collections (opportunity_id, invoice_id, amount, due_at, state, firmes, notes, verification)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .bind(
        body?.opportunity_id ?? null,
        body?.invoice_id ?? body?.factura_id ?? null,
        body?.amount != null ? Number(body.amount) : null,
        body?.due_at || "",
        body?.state || "PENDIENTE",
        body?.firmes ? 1 : 0,
        body?.notes || "",
        body?.verification || "COBRO_ESTIMADO"
      )
      .run();
    // auto alert
    const h = hoursUntil(body?.due_at || "");
    if (h != null && h <= 72) {
      await db
        .prepare(
          `INSERT INTO alerts (level, kind, title, body, ref_type) VALUES (?,?,?,?,?)`
        )
        .bind(
          h <= 24 ? "urgente" : "alta",
          "cobranza",
          `Cobranza ${h <= 24 ? "<24h" : "<72h"}`,
          body?.notes || `Vence ${body?.due_at}`,
          "cobranzas"
        )
        .run();
    }
    return json({ ok: true });
  }

  // —— Caja ——
  if (path === "/api/caja" && method === "GET") {
    const { results } = await db
      .prepare("SELECT * FROM caja_movimientos ORDER BY id DESC LIMIT 200")
      .all();
    const sum = await db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN tipo='INGRESO' THEN amount WHEN tipo='EGRESO' THEN -amount ELSE amount END),0) as saldo
         FROM caja_movimientos`
      )
      .first<{ saldo: number }>();
    return json({ saldo: sum?.saldo ?? 0, movimientos: results || [] });
  }

  if (path === "/api/caja" && method === "POST") {
    const body = await readJson(req);
    if (!body?.tipo || body.amount == null) return json({ error: "tipo y amount requeridos" }, 400);
    await db
      .prepare(
        `INSERT INTO cash_ledger (tipo, amount, concept, ref_type, ref_id, notes) VALUES (?,?,?,?,?,?)`
      )
      .bind(
        body.tipo,
        Number(body.amount),
        body.concept || "",
        body.ref_type || "",
        body.ref_id ?? null,
        body.notes || ""
      )
      .run();
    return json({ ok: true });
  }

  // —— Capital ——
  if (path === "/api/capital" && method === "GET") {
    const latest = await db
      .prepare("SELECT * FROM capital_snapshot ORDER BY id DESC LIMIT 1")
      .first();
    if (!latest) {
      return json({
        capital_operativo_real: null,
        label: LABEL_NO_VERIFICADO,
        formula: "caja + CxC_firmes - deudas - impuestos - compromisos_compra",
      });
    }
    const result = computeCapitalOperativoReal({
      caja: Number(latest.caja) || 0,
      cxc_firmes: Number(latest.cxc_firmes) || 0,
      deudas: Number(latest.deudas) || 0,
      impuestos: Number(latest.impuestos) || 0,
      compromisos_compra: Number(latest.compromisos ?? latest.compromisos_compra) || 0,
    });
    return json({ ...result, snapshot: latest });
  }

  if (path === "/api/capital" && method === "POST") {
    const body = await readJson(req);
    const input = {
      caja: Number(body?.caja) || 0,
      cxc_firmes: Number(body?.cxc_firmes) || 0,
      deudas: Number(body?.deudas) || 0,
      impuestos: Number(body?.impuestos) || 0,
      compromisos_compra: Number(body?.compromisos_compra ?? body?.compromisos) || 0,
    };
    const result = computeCapitalOperativoReal(input);
    await db
      .prepare(
        `INSERT INTO capital_snapshot (caja, cxc_firmes, deudas, impuestos, compromisos, capital_operativo_real, notes)
         VALUES (?,?,?,?,?,?,?)`
      )
      .bind(
        input.caja,
        input.cxc_firmes,
        input.deudas,
        input.impuestos,
        input.compromisos_compra,
        result.capital_operativo_real,
        body?.notes || ""
      )
      .run();
    return json(result);
  }

  // —— Rentabilidad / ranking ——
  if (path === "/api/rentabilidad" && method === "GET") {
    const { results } = await db
      .prepare(
        `SELECT id, external_id, title, utilidad_estimada, capital_requerido, cost_total, precio_objetivo, margin_ratio, verification, mm_score
         FROM opportunities WHERE skipped = 0`
      )
      .all<any>();
    const ranked = rankByCapitalEfficiency(
      (results || []).map((r) => ({
        id: String(r.id),
        utilidad_estimada: r.utilidad_estimada,
        capital_requerido: r.capital_requerido ?? r.cost_total,
      }))
    );
    const byId = new Map((results || []).map((r) => [String(r.id), r]));
    return json({
      items: ranked.map((r) => ({ ...byId.get(r.id), ...r })),
    });
  }

  // —— Alertas ——
  if (path === "/api/alertas" && method === "GET") {
    const { results } = await db
      .prepare("SELECT * FROM alertas WHERE resolved = 0 ORDER BY id DESC")
      .all();
    return json({ items: results || [] });
  }

  if (path === "/api/alertas" && method === "POST") {
    const body = await readJson(req);
    await db
      .prepare(
        `INSERT INTO alerts (level, kind, title, body, ref_type, ref_id) VALUES (?,?,?,?,?,?)`
      )
      .bind(
        body?.level || "info",
        body?.kind || "",
        body?.title || "",
        body?.body || "",
        body?.ref_type || "",
        body?.ref_id || ""
      )
      .run();
    return json({ ok: true });
  }

  if (path.match(/^\/api\/alertas\/\d+\/resolve$/) && method === "POST") {
    const id = Number(path.split("/")[3]);
    await db.prepare("UPDATE alertas SET resolved = 1 WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  // —— Backup export ——
  if (path === "/api/backup/json" && method === "GET") {
    const tables = [
      "settings",
      "opportunities",
      "opportunity_items",
      "suppliers",
      "supplier_matches",
      "cotizaciones",
      "compras",
      "entregas",
      "facturas",
      "cobranzas",
      "caja_movimientos",
      "capital_snapshot",
      "alertas",
      "ventas_mes",
    ];
    const dump: Record<string, unknown[]> = {};
    for (const t of tables) {
      const { results } = await db.prepare(`SELECT * FROM ${t}`).all();
      dump[t] = results || [];
    }
    return json({ exported_at: new Date().toISOString(), tables: dump });
  }

  if (path === "/api/backup/csv" && method === "GET") {
    const table = url.searchParams.get("table") || "opportunities";
    const allowed = new Set([
      "opportunities",
      "suppliers",
      "compras",
      "cobranzas",
      "caja_movimientos",
      "alertas",
      "cotizaciones",
    ]);
    if (!allowed.has(table)) return json({ error: "tabla no permitida" }, 400);
    const { results } = await db.prepare(`SELECT * FROM ${table}`).all();
    const rows = results || [];
    if (!rows.length) {
      return new Response("id\n", {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${table}.csv"`,
        },
      });
    }
    const cols = Object.keys(rows[0] as object);
    const lines = [cols.join(",")];
    for (const r of rows) {
      lines.push(cols.map((c) => csvEscape((r as any)[c])).join(","));
    }
    return new Response(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${table}.csv"`,
        "access-control-allow-origin": "*",
      },
    });
  }

  // —— Indicadores ——
  if (path === "/api/indicadores" && method === "GET") {
    const ym = currentYearMonth();
    const ventasRow = await db
      .prepare("SELECT * FROM ventas_mes WHERE year_month = ?")
      .bind(ym)
      .first<{ ventas: number; ganancia: number }>();
    const opp = await db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN skipped=0 THEN 1 ELSE 0 END) as activas,
          SUM(CASE WHEN pipeline='PRESENTADA' THEN 1 ELSE 0 END) as presentadas,
          SUM(CASE WHEN pipeline='OPS_GANADA' THEN 1 ELSE 0 END) as ganadas,
          SUM(CASE WHEN pipeline IN ('COBRADA','COBRADO') THEN 1 ELSE 0 END) as cobradas,
          SUM(CASE WHEN pipeline='DESCARTADA' THEN 1 ELSE 0 END) as descartadas
         FROM opportunities`
      )
      .first<Record<string, number>>();
    const caja = await db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN tipo='INGRESO' THEN amount WHEN tipo='EGRESO' THEN -amount ELSE amount END),0) as saldo FROM cash_ledger`
      )
      .first<{ saldo: number }>();
    const cxc = await db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) as s FROM collections WHERE firmes=1 AND state NOT IN ('COBRADA','INCOBRABLE')`
      )
      .first<{ s: number }>();
    return json({
      year_month: ym,
      ventas_ledger: ventasRow?.ventas ?? 0,
      ganancia_ledger: ventasRow?.ganancia ?? 0,
      meta_ventas: cfg.metaVentas,
      meta_ganancia: cfg.metaGanancia,
      oportunidades: opp || {},
      caja_saldo: caja?.saldo ?? 0,
      cxc_firmes: cxc?.s ?? 0,
      note: "Indicadores solo desde ledger/DB real — ceros si vacío. No inventa.",
    });
  }

  // —— Proyecciones (ESTIMACIÓN) ——
  if (path === "/api/proyecciones" && method === "GET") {
    const ym = currentYearMonth();
    const ventasRow = await db
      .prepare("SELECT * FROM ventas_mes WHERE year_month = ?")
      .bind(ym)
      .first<{ ventas: number; ganancia: number }>();
    const pipe = await db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN verification='VERIFICADO' THEN precio_objetivo ELSE 0 END),0) as sell,
          COALESCE(SUM(CASE WHEN verification='VERIFICADO' THEN utilidad_estimada ELSE 0 END),0) as net
         FROM opportunities
         WHERE skipped=0 AND pipeline NOT IN ('DESCARTADA','PERDIDA','COBRADA','COBRADO','SKIPPED_HARD')`
      )
      .first<{ sell: number; net: number }>();
    const scenarios = projectScenarios({
      ventas_reales_mes: ventasRow?.ventas ?? 0,
      ganancia_real_mes: ventasRow?.ganancia ?? 0,
      pipeline_sell_verified: pipe?.sell ?? 0,
      pipeline_net_estimated: pipe?.net ?? 0,
    });
    return json({
      label: "ESTIMACIÓN",
      year_month: ym,
      scenarios,
      warning: "Proyecciones = ESTIMACIÓN. No son hechos. No se cuentan como capital.",
    });
  }

  // —— Score preview (no invent) ——
  if (path === "/api/score/preview" && method === "POST") {
    const body = await readJson(req);
    return json(computeMmScore(body || {}));
  }

  return null;
}

type SqlVal = string | number | null;
