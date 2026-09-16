import type { MiniDb } from "../db.js";
import { num, numOrNull } from "../db.js";
import { computeMmScore } from "../engines/score.js";
import { computeCapitalOperativoReal } from "../engines/capital.js";
import { computeProfit } from "../engines/profit.js";
import { buildQueHagoHoy, type RawSignal } from "../engines/tasks.js";
import { projectScenarios } from "../engines/projections.js";
import { detectBottleneck } from "../engines/bottleneck.js";
import { isHardSkipped, hardSkipReason } from "../engines/hardskip.js";
import { hoursUntil, currentYearMonth } from "../time.js";
import {
  MARKUP_DEFAULT,
  META_VENTAS_MENSUAL,
  META_GANANCIA_MENSUAL,
  LABEL_STOCK_NO_VERIFICADO,
  LABEL_PRECIO_NO_VERIFICADO,
  LABEL_COBRO_ESTIMADO,
} from "../constants.js";

export async function cfg(db: MiniDb, key: string, fallback: string): Promise<string> {
  const row = await db.one<{ value: string }>("SELECT value FROM config WHERE key = ?", key);
  return row?.value ?? fallback;
}

export async function cfgNum(db: MiniDb, key: string, fallback: number): Promise<number> {
  const v = await cfg(db, key, String(fallback));
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function readCapital(db: MiniDb) {
  const cajaRow = await db.one<{ s: number | null }>(
    `SELECT COALESCE(SUM(CASE WHEN tipo='INGRESO' THEN amount WHEN tipo='EGRESO' THEN -amount ELSE amount END), 0) AS s FROM cash_ledger`
  );
  const cxc = await db.one<{ s: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM collections WHERE firmes = 1 AND state NOT IN ('COBRADA','INCOBRABLE')`
  );
  const deudas = await db.one<{ s: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM purchases WHERE status IN ('PENDIENTE','COMPROMETIDO') AND paid_at = ''`
  );
  const imp = await db.one<{ s: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM cash_ledger WHERE concept = 'IMPUESTO' AND tipo = 'EGRESO'`
  );
  const compromisos = await db.one<{ s: number | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM purchases WHERE status = 'COMPROMETIDO'`
  );
  // Quotes NEVER count as cash
  return computeCapitalOperativoReal({
    caja: num(cajaRow?.s),
    cxc_firmes: num(cxc?.s),
    deudas: num(deudas?.s),
    impuestos: num(imp?.s),
    compromisos: num(compromisos?.s),
  });
}

export async function ventasMes(db: MiniDb) {
  const ym = currentYearMonth();
  const row = await db.one<{ ventas: number; ganancia: number }>(
    "SELECT ventas, ganancia FROM ventas_mes WHERE year_month = ?",
    ym
  );
  return { year_month: ym, ventas: num(row?.ventas), ganancia: num(row?.ganancia) };
}

function bestMatchType(matches: Array<{ match_type: string; stock_verified: number }>): {
  match_type: "EXACTO" | "EQUIVALENTE" | "NO MATCH" | null;
  stock_verified: boolean;
} {
  if (!matches.length) return { match_type: null, stock_verified: false };
  const exact = matches.filter((m) => m.match_type === "EXACTO");
  if (exact.length) {
    return { match_type: "EXACTO", stock_verified: exact.some((m) => m.stock_verified === 1) };
  }
  const eq = matches.filter((m) => m.match_type === "EQUIVALENTE");
  if (eq.length) {
    return { match_type: "EQUIVALENTE", stock_verified: eq.some((m) => m.stock_verified === 1) };
  }
  if (matches.some((m) => m.match_type === "NO MATCH")) {
    return { match_type: "NO MATCH", stock_verified: false };
  }
  return { match_type: null, stock_verified: false };
}

export async function scoreOpportunity(db: MiniDb, oppId: number, capitalLibre: number) {
  const opp = await db.one<Record<string, unknown>>("SELECT * FROM opportunities WHERE id = ?", oppId);
  if (!opp) return null;
  const items = await db.all<{ id: number }>("SELECT id FROM opportunity_items WHERE opportunity_id = ?", oppId);
  const matches = await db.all<{ match_type: string; stock_verified: number; cost_verified: number }>(
    "SELECT match_type, stock_verified, cost_verified FROM supplier_matches WHERE opportunity_id = ?",
    oppId
  );
  const quotes = await db.all<{
    cost_total: number | null;
    sell_price: number | null;
    gross: number | null;
    net_estimated: number | null;
    capital: number | null;
    verification: string;
  }>("SELECT * FROM quotes WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1", oppId);

  const bm = bestMatchType(matches);
  const coverage = items.length ? matches.filter((m) => m.match_type !== "NO MATCH").length / items.length : 0;
  const q = quotes[0];
  const hasVerifiedCost = matches.some((m) => m.cost_verified === 1) || (q && q.verification.includes("VERIFICADO"));
  const hours = hoursUntil(String(opp.cierre_at || ""));

  const breakdown = computeMmScore({
    fit_hint: numOrNull(opp.fit_hint),
    rubros: String(opp.rubros || ""),
    margin_ratio: numOrNull(opp.margin_ratio) ?? numOrNull(q?.gross && q?.sell_price ? Number(q.gross) / Number(q.sell_price) : null),
    has_verified_cost: !!hasVerifiedCost,
    match_type: bm.match_type,
    stock_verified: bm.stock_verified,
    coverage_ratio: coverage,
    capital_requerido: numOrNull(opp.capital_requerido) ?? numOrNull(q?.capital),
    capital_libre: capitalLibre,
    cobro_days: null,
    cobro_firmes: null,
    win_probability: null,
    historial_score: null,
  });

  await db.run(
    "UPDATE opportunities SET mm_score = ?, mm_score_json = ?, match_type = ?, stock_verified = ?, updated_at = datetime('now') WHERE id = ?",
    breakdown.total,
    JSON.stringify(breakdown),
    bm.match_type || "",
    bm.stock_verified ? 1 : 0,
    oppId
  );

  return { breakdown, hours, coverage, match: bm };
}

export async function refreshAllScores(db: MiniDb) {
  const cap = await readCapital(db);
  const opps = await db.all<{ id: number }>("SELECT id FROM opportunities WHERE skipped = 0");
  for (const o of opps) {
    await scoreOpportunity(db, o.id, cap.libre);
  }
}

export async function buildSignals(db: MiniDb): Promise<RawSignal[]> {
  const signals: RawSignal[] = [];
  const cap = await readCapital(db);
  if (cap.capital_operativo_real < 0) {
    signals.push({
      kind: "capital",
      id: "capital",
      title: "Capital operativo real",
      amount: cap.capital_operativo_real,
    });
  }

  const opps = await db.all<Record<string, unknown>>(
    "SELECT * FROM opportunities WHERE skipped = 0 AND pipeline NOT IN ('DESCARTADA','PERDIDA','COBRADO','SKIPPED_HARD')"
  );
  for (const o of opps) {
    const id = String(o.id);
    const title = `${o.external_id} — ${o.title}`;
    const hours = hoursUntil(String(o.cierre_at || ""));
    if (hours != null) {
      signals.push({ kind: "cierre", id, title, hours_to_event: hours, pipeline: String(o.pipeline) });
    }
    if (o.pipeline === "OPS_GANADA" || o.pipeline === "COMPRANDO") {
      signals.push({ kind: "compra", id, title, pipeline: String(o.pipeline) });
    }
    if (o.pipeline === "ENTREGANDO") {
      signals.push({ kind: "entrega", id, title, pipeline: String(o.pipeline) });
    }
    if (o.pipeline === "FACTURANDO") {
      signals.push({ kind: "facturacion", id, title, pipeline: String(o.pipeline) });
    }
    if (!o.pliego_url && !o.pliego_file) {
      signals.push({ kind: "pliego", id, title, extra: "Sin URL de pliego" });
    }
    if (!o.stock_verified) {
      const nItems = await db.one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM opportunity_items WHERE opportunity_id = ?",
        o.id as number
      );
      if ((nItems?.n || 0) > 0) {
        signals.push({ kind: "stock", id, title, extra: LABEL_STOCK_NO_VERIFICADO });
      }
    }
    if (o.mm_score != null) {
      signals.push({
        kind: "oportunidad",
        id,
        title,
        mm_score: num(o.mm_score),
        pipeline: String(o.pipeline),
      });
    }
  }

  const cols = await db.all<Record<string, unknown>>(
    "SELECT * FROM collections WHERE state NOT IN ('COBRADA','INCOBRABLE')"
  );
  for (const c of cols) {
    const hours = hoursUntil(String(c.due_at || ""));
    signals.push({
      kind: "cobranza",
      id: `col-${c.id}`,
      title: `Cobranza #${c.id} ${c.amount != null ? `$ ${c.amount}` : LABEL_COBRO_ESTIMADO}`,
      hours_to_event: hours,
      extra: `${c.state}${c.firmes ? " FIRMES" : " " + LABEL_COBRO_ESTIMADO}`,
    });
  }
  return signals;
}

export async function syncAlerts(db: MiniDb) {
  const tasks = buildQueHagoHoy(await buildSignals(db));
  const cap = await readCapital(db);
  await db.run("DELETE FROM alerts WHERE resolved = 0 AND kind IN ('task','capital','hardskip')");
  for (const t of tasks.filter((x) => x.priority === "urgente")) {
    await db.run(
      "INSERT INTO alerts (level, kind, title, body, ref_type, ref_id) VALUES (?,?,?,?,?,?)",
      "urgente",
      "task",
      t.action,
      `${t.title} — ${t.reason}`,
      "opportunity",
      t.ref_id
    );
  }
  if (cap.capital_operativo_real < 0) {
    await db.run(
      "INSERT INTO alerts (level, kind, title, body, ref_type, ref_id) VALUES (?,?,?,?,?,?)",
      "urgente",
      "capital",
      "Capital operativo real negativo",
      cap.formula_es,
      "caja",
      "capital"
    );
  }
}

export async function dashboard(db: MiniDb) {
  const cap = await readCapital(db);
  const vm = await ventasMes(db);
  const metaV = await cfgNum(db, "meta_ventas_mensual", META_VENTAS_MENSUAL);
  const metaG = await cfgNum(db, "meta_ganancia_mensual", META_GANANCIA_MENSUAL);
  const counts = await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM opportunities WHERE skipped = 0");
  const open = await db.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM opportunities WHERE skipped = 0 AND pipeline NOT IN ('DESCARTADA','PERDIDA','COBRADO','SKIPPED_HARD')"
  );
  const hasReal = vm.ventas > 0 || vm.ganancia > 0;
  return {
    capital_operativo_real: cap.capital_operativo_real,
    caja: cap.caja,
    por_cobrar: cap.por_cobrar,
    comprometido: cap.comprometido,
    libre: cap.libre,
    formula: cap.formula_es,
    quotes_excluded: true,
    metas: {
      ventas: metaV,
      ganancia: metaG,
      ventas_reales: vm.ventas,
      ganancia_real: vm.ganancia,
      progress_ventas: hasReal ? vm.ventas / metaV : 0,
      progress_ganancia: hasReal ? vm.ganancia / metaG : 0,
      progress_only_if_real: true,
      note: hasReal
        ? "Progreso con datos reales del mes"
        : "Sin ventas/ganancia reales cargadas → progreso 0 (metas aspiracionales, no logradas)",
    },
    pipeline_open: num(open?.n),
    opportunities_loaded: num(counts?.n),
    labels: {
      stock: LABEL_STOCK_NO_VERIFICADO,
      precio: LABEL_PRECIO_NO_VERIFICADO,
      cobro: LABEL_COBRO_ESTIMADO,
    },
  };
}

export async function queHagoHoy(db: MiniDb) {
  const signals = await buildSignals(db);
  return buildQueHagoHoy(signals);
}

export async function listOportunidades(db: MiniDb) {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, external_id, source, title, organism, rubros, modality, numero,
            source_url, url, pliego_url, pliego_file, bid_scope, cierre_at, apertura_at,
            pipeline, mm_score, mm_score_json, verification, match_type, stock_verified,
            skipped, skip_reason, verified_at
     FROM opportunities
     ORDER BY skipped ASC, CASE WHEN mm_score IS NULL THEN 1 ELSE 0 END, mm_score DESC, id DESC`
  );
  return rows.map((r) => ({
    ...r,
    pliego_descarga: r.pliego_url || r.pliego_file || null,
    stock_label: r.stock_verified ? "STOCK_VERIFICADO" : LABEL_STOCK_NO_VERIFICADO,
  }));
}

export async function opportunityDetail(db: MiniDb, id: number) {
  const opp = await db.one<Record<string, unknown>>("SELECT * FROM opportunities WHERE id = ?", id);
  if (!opp) return null;
  const items = await db.all<Record<string, unknown>>(
    "SELECT * FROM opportunity_items WHERE opportunity_id = ? ORDER BY line_no",
    id
  );
  const matches = await db.all<Record<string, unknown>>(
    "SELECT * FROM supplier_matches WHERE opportunity_id = ? ORDER BY id",
    id
  );
  const quotes = await db.all<Record<string, unknown>>(
    "SELECT * FROM quotes WHERE opportunity_id = ? ORDER BY id DESC",
    id
  );
  const purchases = await db.all<Record<string, unknown>>(
    "SELECT * FROM purchases WHERE opportunity_id = ? ORDER BY id DESC",
    id
  );
  let scoreJson: unknown = {};
  try {
    scoreJson = JSON.parse(String(opp.mm_score_json || "{}"));
  } catch {
    scoreJson = {};
  }

  const profitLines = items.map((it) => ({
    qty: num(it.qty) || 1,
    unit_cost: numOrNull(it.unit_cost),
    cost_verified: Number(it.cost_verified) === 1,
  }));
  const markup = await cfgNum(db, "markup_default", MARKUP_DEFAULT);
  const profit = computeProfit(profitLines, { markup });

  const suppliers = {
    exacto: matches.filter((m) => m.match_type === "EXACTO"),
    equivalente: matches.filter((m) => m.match_type === "EQUIVALENTE"),
    no: matches.filter((m) => m.match_type === "NO MATCH" || !m.match_type),
  };

  return {
    opportunity: {
      ...opp,
      stock_label: opp.stock_verified ? "STOCK_VERIFICADO" : LABEL_STOCK_NO_VERIFICADO,
    },
    items: items.map((it) => ({
      ...it,
      cost_label: it.cost_verified ? "VERIFICADO" : LABEL_PRECIO_NO_VERIFICADO,
    })),
    score: scoreJson,
    pipeline: opp.pipeline,
    suppliers,
    rentabilidad: profit,
    bid_scope: opp.bid_scope || null,
    quotes,
    purchases,
    download_pliego: opp.pliego_url || opp.pliego_file || null,
    source_url: opp.source_url || opp.url,
  };
}

export async function addOpportunityManual(
  db: MiniDb,
  body: {
    title?: string;
    source_url?: string;
    external_id?: string;
    organism?: string;
    rubros?: string;
    cierre_at?: string;
    pliego_url?: string;
    bid_scope?: string;
    notes?: string;
  }
) {
  const url = (body.source_url || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false as const, error: "source_url (URL oficial) es obligatorio" };
  }
  const ext = (body.external_id || "").trim() || `MANUAL-${Date.now()}`;
  if (isHardSkipped(ext)) {
    return { ok: false as const, error: hardSkipReason(ext) };
  }
  const title = (body.title || "").trim();
  if (!title) return { ok: false as const, error: "title es obligatorio" };

  try {
    const res = await db.run(
      `INSERT INTO opportunities (external_id, source, title, organism, rubros, source_url, url, pliego_url, bid_scope, cierre_at, notes, verification, verified_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
      ext,
      "MANUAL",
      title,
      body.organism || "",
      body.rubros || "",
      url,
      url,
      body.pliego_url || "",
      body.bid_scope || "",
      body.cierre_at || "",
      body.notes || "",
      "URL_CARGADA"
    );
    const cap = await readCapital(db);
    await scoreOpportunity(db, res.lastId, cap.libre);
    await syncAlerts(db);
    return { ok: true as const, id: res.lastId };
  } catch (e) {
    return { ok: false as const, error: String(e) };
  }
}

export async function cobranzasList(db: MiniDb) {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT c.*, o.external_id, o.title AS opp_title
     FROM collections c
     LEFT JOIN opportunities o ON o.id = c.opportunity_id
     ORDER BY CASE c.state
       WHEN 'VENCIDA' THEN 0 WHEN 'EN_GESTION' THEN 1 WHEN 'PENDIENTE' THEN 2
       WHEN 'PARCIAL' THEN 3 ELSE 4 END, c.due_at`
  );
  return rows.map((r) => ({
    ...r,
    cobro_label: r.firmes ? "FIRMES" : LABEL_COBRO_ESTIMADO,
  }));
}

export async function alertsList(db: MiniDb) {
  return db.all("SELECT * FROM alerts WHERE resolved = 0 ORDER BY CASE level WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 ELSE 2 END, id DESC");
}

export async function projections(db: MiniDb) {
  const vm = await ventasMes(db);
  const q = await db.one<{ sell: number | null; net: number | null }>(
    `SELECT SUM(sell_price) AS sell, SUM(net_estimated) AS net
     FROM quotes q
     JOIN opportunities o ON o.id = q.opportunity_id
     WHERE o.skipped = 0 AND o.pipeline NOT IN ('DESCARTADA','PERDIDA','SKIPPED_HARD')
       AND q.verification LIKE '%VERIFICADO%'`
  );
  return {
    label: "ESTIMACIÓN",
    disclaimer:
      "Simulador. No es un forecast comprometido. Sin datos reales las tres bandas quedan en 0.",
    scenarios: projectScenarios({
      ventas_reales_mes: vm.ventas,
      ganancia_real_mes: vm.ganancia,
      pipeline_sell_verified: num(q?.sell),
      pipeline_net_estimated: num(q?.net),
    }),
  };
}

export async function bottleneck(db: MiniDb) {
  const cap = await readCapital(db);
  const open = await db.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM opportunities WHERE skipped = 0 AND pipeline NOT IN ('DESCARTADA','PERDIDA','COBRADO','SKIPPED_HARD')"
  );
  const closing = await db.all<{ cierre_at: string }>(
    "SELECT cierre_at FROM opportunities WHERE skipped = 0 AND pipeline NOT IN ('DESCARTADA','PERDIDA','COBRADO','SKIPPED_HARD')"
  );
  let closing24 = 0;
  for (const r of closing) {
    const h = hoursUntil(r.cierre_at);
    if (h != null && h >= 0 && h <= 24) closing24 += 1;
  }
  const missingStock = await db.one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM opportunities o
     WHERE o.skipped = 0 AND o.stock_verified = 0
       AND EXISTS (SELECT 1 FROM opportunity_items i WHERE i.opportunity_id = o.id)`
  );
  const won = await db.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM opportunities WHERE pipeline = 'OPS_GANADA'"
  );
  const overdue = await db.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM collections WHERE state = 'VENCIDA'"
  );
  const cot = await db.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM opportunities WHERE pipeline IN ('COTIZANDO','ANALISIS','BUSCANDO_PROVEEDOR')"
  );
  const sinPliego = await db.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM opportunities WHERE skipped = 0 AND pliego_url = '' AND pliego_file = ''"
  );
  const hard = await db.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM opportunities WHERE skipped = 1 AND skip_reason LIKE '%HARD_SKIP%'"
  );
  return detectBottleneck({
    open_opps: num(open?.n),
    closing_24h: closing24,
    missing_stock: num(missingStock?.n),
    won_without_buy: num(won?.n),
    overdue_collections: num(overdue?.n),
    capital_libre: cap.libre,
    cotizando: num(cot?.n),
    sin_pliego: num(sinPliego?.n),
    skipped_hard: num(hard?.n),
  });
}

export async function insertSkippedHard(db: MiniDb, externalId: string, sourceUrl = "") {
  if (!isHardSkipped(externalId)) return;
  const existing = await db.one("SELECT id FROM opportunities WHERE external_id = ?", String(externalId));
  if (existing) {
    await db.run(
      "UPDATE opportunities SET skipped = 1, skip_reason = ?, pipeline = 'SKIPPED_HARD' WHERE external_id = ?",
      hardSkipReason(externalId),
      String(externalId)
    );
    return;
  }
  await db.run(
    `INSERT INTO opportunities (external_id, source, title, source_url, url, skipped, skip_reason, pipeline, verification)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    String(externalId),
    "CODINEU",
    "HARD SKIP — no accionable",
    sourceUrl,
    sourceUrl,
    1,
    hardSkipReason(externalId),
    "SKIPPED_HARD",
    "SKIPPED"
  );
}
