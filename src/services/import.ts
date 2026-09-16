import type { MiniDb } from "../db.js";
import { isHardSkipped, hardSkipReason } from "../engines/hardskip.js";
import { insertSkippedHard, refreshAllScores, syncAlerts } from "./state.js";
import { guardNoFakeTenders } from "../engines/invent.js";

export type ImportOpp = {
  external_id: string;
  source?: string;
  title?: string;
  organism?: string;
  rubros?: string;
  modality?: string;
  numero?: string;
  source_url?: string;
  url?: string;
  pliego_url?: string;
  pliego_file?: string;
  bid_scope?: string;
  apertura_at?: string;
  cierre_at?: string;
  publicacion_at?: string;
  timing_state?: string;
  pipeline?: string;
  fit_hint?: number | null;
  risk_level?: string;
  skipped?: number;
  skip_reason?: string;
  notes?: string;
  raw_json?: string;
  verification?: string;
  verified_at?: string;
  items?: ImportItem[];
  matches?: ImportMatch[];
};

export type ImportItem = {
  line_no?: number;
  description?: string;
  qty?: number;
  unit?: string;
  brand?: string;
  model?: string;
  unit_cost?: number | null;
  cost_verified?: boolean;
  verification?: string;
  source_url?: string;
  verified_at?: string;
};

export type ImportMatch = {
  line_no?: number;
  supplier_name?: string;
  product_label?: string;
  match_type?: string;
  unit_cost?: number | null;
  cost_verified?: boolean;
  stock?: number | null;
  stock_verified?: boolean;
  why?: string;
  verification?: string;
  source_url?: string;
  verified_at?: string;
};

export type ImportPayload = {
  opportunities?: ImportOpp[];
  suppliers?: Array<{ name: string; web?: string; source_url?: string; verified?: boolean }>;
  cash?: Array<{ tipo: string; amount: number; concept?: string; notes?: string }>;
  collections?: Array<Record<string, unknown>>;
  ventas_mes?: Array<{ year_month: string; ventas: number; ganancia: number }>;
};

function mapMatchType(raw: string | undefined, verified: boolean): string {
  const u = (raw || "").toUpperCase();
  if (u === "EXACTO" && verified) return "EXACTO";
  if (u === "EXACTO") return "EQUIVALENTE"; // MATCH EXACTO only if proven
  if (u.includes("EQUIV") || u === "POSIBLE" || u === "PROBABLE") return "EQUIVALENTE";
  if (u.includes("NO") || u === "NO_CUMPLE" || u === "NO MATCH") return "NO MATCH";
  return "NO MATCH";
}

export async function importPayload(db: MiniDb, payload: ImportPayload) {
  const opps = payload.opportunities || [];
  const guard = guardNoFakeTenders(
    opps.map((o) => ({ source_url: o.source_url || o.url, url: o.url }))
  );
  if (!guard.ok && opps.length) {
    return { ok: false as const, error: guard.reason, imported: 0, skipped_hard: 0 };
  }

  let imported = 0;
  let skippedHard = 0;
  const errors: string[] = [];

  for (const s of payload.suppliers || []) {
    if (!s.name) continue;
    await db.run(
      `INSERT INTO suppliers (name, web, source_url, verified, verified_at)
       VALUES (?,?,?,?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)
       ON CONFLICT(name) DO UPDATE SET web = excluded.web`,
      s.name,
      s.web || "",
      s.source_url || s.web || "",
      s.verified ? 1 : 0,
      s.verified ? 1 : 0
    );
  }

  for (const o of opps) {
    const ext = String(o.external_id || "").trim();
    if (!ext) {
      errors.push("oportunidad sin external_id");
      continue;
    }
    if (isHardSkipped(ext)) {
      await insertSkippedHard(db, ext, o.source_url || o.url || "");
      skippedHard += 1;
      continue;
    }
    const url = (o.source_url || o.url || "").trim();
    if (!url) {
      errors.push(`${ext}: falta source_url`);
      continue;
    }
    try {
      await db.run(
        `INSERT INTO opportunities (
           external_id, source, title, organism, rubros, modality, numero,
           source_url, url, pliego_url, pliego_file, bid_scope,
           apertura_at, cierre_at, publicacion_at, timing_state, pipeline,
           fit_hint, risk_level, skipped, skip_reason, notes, raw_json,
           verification, verified_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(external_id) DO UPDATE SET
           title=excluded.title, organism=excluded.organism, rubros=excluded.rubros,
           source_url=excluded.source_url, url=excluded.url, pliego_url=excluded.pliego_url,
           bid_scope=excluded.bid_scope, cierre_at=excluded.cierre_at,
           fit_hint=excluded.fit_hint, notes=excluded.notes, updated_at=datetime('now')`,
        ext,
        o.source || "CODINEU",
        o.title || "",
        o.organism || "",
        o.rubros || "",
        o.modality || "",
        o.numero || "",
        url,
        o.url || url,
        o.pliego_url || "",
        o.pliego_file || "",
        o.bid_scope || "",
        o.apertura_at || "",
        o.cierre_at || "",
        o.publicacion_at || "",
        o.timing_state || "NO VERIFICADO",
        o.pipeline || "NUEVA",
        o.fit_hint ?? null,
        o.risk_level || "",
        o.skipped ? 1 : 0,
        o.skip_reason || "",
        o.notes || "",
        o.raw_json || "{}",
        o.verification || "NO VERIFICADO",
        o.verified_at || null
      );
      const row = await db.one<{ id: number }>("SELECT id FROM opportunities WHERE external_id = ?", ext);
      if (!row) continue;
      const oppId = row.id;

      if (o.items?.length) {
        await db.run("DELETE FROM opportunity_items WHERE opportunity_id = ?", oppId);
        for (const it of o.items) {
          const costVerified = it.cost_verified === true && it.unit_cost != null;
          await db.run(
            `INSERT INTO opportunity_items (opportunity_id, line_no, description, qty, unit, brand, model, unit_cost, cost_verified, verification, source_url, verified_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            oppId,
            it.line_no ?? 1,
            it.description || "",
            it.qty ?? 1,
            it.unit || "u",
            it.brand || "",
            it.model || "",
            costVerified ? (it.unit_cost ?? null) : (it.unit_cost ?? null),
            costVerified ? 1 : 0,
            it.verification || (costVerified ? "VERIFICADO" : "PRECIO_NO_VERIFICADO"),
            it.source_url || url,
            it.verified_at || null
          );
        }
      }

      if (o.matches?.length) {
        await db.run("DELETE FROM supplier_matches WHERE opportunity_id = ?", oppId);
        const items = await db.all<{ id: number; line_no: number }>(
          "SELECT id, line_no FROM opportunity_items WHERE opportunity_id = ?",
          oppId
        );
        const byLine = new Map(items.map((i) => [i.line_no, i.id]));
        for (const m of o.matches) {
          const provenExact = (m.match_type || "").toUpperCase() === "EXACTO" && m.cost_verified === true;
          const mt = mapMatchType(m.match_type, provenExact);
          const costVerified = m.cost_verified === true && m.unit_cost != null;
          const stockVerified = m.stock_verified === true && m.stock != null;
          let supplierId: number | null = null;
          if (m.supplier_name) {
            await db.run(
              `INSERT INTO suppliers (name, source_url, verified) VALUES (?,?,0)
               ON CONFLICT(name) DO NOTHING`,
              m.supplier_name,
              m.source_url || ""
            );
            const srow = await db.one<{ id: number }>("SELECT id FROM suppliers WHERE name = ?", m.supplier_name);
            supplierId = srow?.id ?? null;
          }
          await db.run(
            `INSERT INTO supplier_matches (
               opportunity_id, item_id, supplier_id, supplier_name, product_label, match_type,
               unit_cost, stock, stock_verified, cost_verified, why, verification, source_url, verified_at
             ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            oppId,
            m.line_no != null ? byLine.get(m.line_no) ?? null : null,
            supplierId,
            m.supplier_name || "",
            m.product_label || "",
            mt,
            costVerified ? (m.unit_cost ?? null) : (m.unit_cost ?? null),
            stockVerified ? (m.stock ?? null) : null,
            stockVerified ? 1 : 0,
            costVerified ? 1 : 0,
            m.why || (mt === "EXACTO" ? "MATCH EXACTO proven" : mt),
            m.verification || (costVerified ? "VERIFICADO" : "NO VERIFICADO"),
            m.source_url || url,
            m.verified_at || null
          );
        }
      }
      imported += 1;
    } catch (e) {
      errors.push(`${ext}: ${String(e)}`);
    }
  }

  for (const c of payload.cash || []) {
    if (!c.tipo || !Number.isFinite(c.amount)) continue;
    await db.run(
      "INSERT INTO cash_ledger (tipo, amount, concept, notes, verified_at) VALUES (?,?,?,?, datetime('now'))",
      c.tipo,
      c.amount,
      c.concept || "",
      c.notes || ""
    );
  }

  await refreshAllScores(db);
  await syncAlerts(db);
  return { ok: true as const, imported, skipped_hard: skippedHard, errors };
}
