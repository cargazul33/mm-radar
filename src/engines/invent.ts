import {
  LABEL_NO_VERIFICADO,
  LABEL_STOCK_NO_VERIFICADO,
  LABEL_PRECIO_NO_VERIFICADO,
  LABEL_COBRO_ESTIMADO,
} from "../constants.js";

/**
 * Reglas anti-invención: nunca fabricar precios, stock ni proveedores.
 * Campos sin evidencia → labels explícitos.
 */
export type VerifiedField =
  | { status: "VERIFICADO"; value: unknown; source?: string; verified_at?: string }
  | { status: "NO VERIFICADO"; value: null; reason: string };

export function requireVerified<T>(
  value: T | null | undefined,
  reasonIfMissing = "sin evidencia en origen"
): VerifiedField {
  if (value === null || value === undefined || value === "") {
    return { status: LABEL_NO_VERIFICADO as "NO VERIFICADO", value: null, reason: reasonIfMissing };
  }
  return { status: "VERIFICADO", value };
}

export function labelUnverified(label?: string): string {
  return label ? `${label}: ${LABEL_NO_VERIFICADO}` : LABEL_NO_VERIFICADO;
}

/** True si el payload intenta inventar (precios/stock/proveedor sin flag de verificación). */
export function inventFlags(input: {
  unit_cost?: number | null;
  unit_price?: number | null;
  stock?: number | null;
  supplier_name?: string | null;
  cost_verified?: boolean;
  price_verified?: boolean;
  stock_verified?: boolean;
  supplier_verified?: boolean;
  cobro_amount?: number | null;
  cobro_firmes?: boolean;
}): string[] {
  const flags: string[] = [];
  if (input.unit_cost != null && input.cost_verified !== true) {
    flags.push(LABEL_PRECIO_NO_VERIFICADO);
    flags.push("COSTO_SIN_VERIFICAR");
  }
  if (input.unit_price != null && input.price_verified !== true) {
    flags.push(LABEL_PRECIO_NO_VERIFICADO);
  }
  if (input.stock != null && input.stock_verified !== true) {
    flags.push(LABEL_STOCK_NO_VERIFICADO);
    flags.push("STOCK_SIN_VERIFICAR");
  }
  if (input.supplier_name && input.supplier_verified !== true) {
    flags.push("PROVEEDOR_SIN_VERIFICAR");
  }
  if (input.cobro_amount != null && input.cobro_firmes !== true) {
    flags.push(LABEL_COBRO_ESTIMADO);
  }
  return [...new Set(flags)];
}

/** Sanitize opportunity for display: missing numeric commercial fields → null + label. */
export function sanitizeOpportunityDisplay(opp: Record<string, unknown>): Record<string, unknown> {
  const out = { ...opp };
  const numericKeys = [
    "cost_total",
    "precio_objetivo",
    "utilidad_estimada",
    "capital_requerido",
  ];
  for (const k of numericKeys) {
    if (out[k] == null || out[k] === "") {
      out[k] = null;
      out[`${k}_label`] = LABEL_PRECIO_NO_VERIFICADO;
    }
  }
  if (!out.stock_verified) out.stock_label = LABEL_STOCK_NO_VERIFICADO;
  if (!out.verification) out.verification = LABEL_NO_VERIFICADO;
  return out;
}

export function assertNoInventPolicy(): { policy: string; invent_allowed: false } {
  return {
    policy:
      "NEVER invent opportunities, prices, stock, suppliers. Labels: STOCK_NO_VERIFICADO, PRECIO_NO_VERIFICADO, COBRO_ESTIMADO. MATCH EXACTO only if proven.",
    invent_allowed: false,
  };
}

/** Guard: seed/import must not fabricate tender rows. */
export function guardNoFakeTenders(rows: unknown[]): { ok: boolean; reason: string } {
  if (!Array.isArray(rows)) return { ok: false, reason: "rows no es array" };
  for (const r of rows) {
    if (!r || typeof r !== "object") return { ok: false, reason: "fila inválida" };
    const row = r as Record<string, unknown>;
    if (!row.source_url && !row.url) {
      return { ok: false, reason: "falta source_url/url en fila externa" };
    }
  }
  return { ok: true, reason: "ok" };
}
