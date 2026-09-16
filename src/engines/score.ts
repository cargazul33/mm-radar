import { SCORE_BANDS, RUBROS_PRIORITARIOS, RUBROS_DEPRIORITARIOS } from "../constants.js";

export type ScoreInput = {
  /** Encaje rubro / hint 0-100 */
  fit_hint?: number | null;
  rubros?: string | null;
  /** Margen bruto (utilidad/venta) si verificado */
  margin_ratio?: number | null;
  has_verified_cost?: boolean;
  /** Abastecimiento */
  match_type?: "EXACTO" | "EQUIVALENTE" | "NO MATCH" | null;
  stock_verified?: boolean;
  coverage_ratio?: number | null; // 0-1 ítems con match
  /** Capital requerido vs capital libre */
  capital_requerido?: number | null;
  capital_libre?: number | null;
  /** Cobro: días estimados / firmeza */
  cobro_days?: number | null;
  cobro_firmes?: boolean | null;
  /** Probabilidad de ganar 0-1 si hay historial/dato */
  win_probability?: number | null;
  /** Historial con organismo / similar */
  historial_score?: number | null; // 0-10 ya escalado o 0-1
  avoided_category?: boolean;
};

export type ScoreBreakdown = {
  encaje: number; // 0-20
  margen: number; // 0-20
  abastecimiento: number; // 0-15
  capital: number; // 0-10
  cobro: number; // 0-15
  probabilidad: number; // 0-10
  historial: number; // 0-10
  total: number;
  band: string;
  why: string[];
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function scoreBand(total: number): string {
  const t = clamp(total);
  for (const b of SCORE_BANDS) {
    if (t >= b.min && t <= b.max) return b.band;
  }
  return "DESCARTAR";
}

export function rubroPriority(rubros: string | null | undefined): {
  priority: "alta" | "media" | "baja";
  avoided: boolean;
  why: string;
} {
  const r = (rubros || "").toLowerCase();
  if (!r.trim()) return { priority: "media", avoided: false, why: "rubro NO VERIFICADO" };
  for (const d of RUBROS_DEPRIORITARIOS) {
    if (r.includes(d)) return { priority: "baja", avoided: true, why: `deprioritario: ${d}` };
  }
  for (const p of RUBROS_PRIORITARIOS) {
    if (r.includes(p)) return { priority: "alta", avoided: false, why: `prioritario: ${p}` };
  }
  return { priority: "media", avoided: false, why: "rubro neutro" };
}

/**
 * Score M&M 0–100:
 * Encaje 0-20, margen 0-20, abastecimiento 0-15, capital 0-10,
 * cobro 0-15, probabilidad 0-10, historial 0-10.
 * Sin dato → 0 + explicación NO VERIFICADO. No inventa.
 */
export function computeMmScore(input: ScoreInput): ScoreBreakdown {
  const why: string[] = [];
  const rp = rubroPriority(input.rubros);
  const avoided = input.avoided_category === true || rp.avoided;

  // Encaje 0-20
  let encaje = 0;
  if (avoided) {
    encaje = 0;
    why.push(`encaje: ${rp.why} → 0/20`);
  } else if (input.fit_hint != null && Number.isFinite(input.fit_hint)) {
    encaje = clamp((input.fit_hint / 100) * 20, 0, 20);
    why.push(`encaje: hint ${input.fit_hint} (${rp.why}) → ${encaje}/20`);
  } else if (rp.priority === "alta") {
    encaje = 12;
    why.push(`encaje: rubro prioritario sin hint → 12/20`);
  } else {
    why.push("encaje: NO VERIFICADO → 0/20");
  }

  // Margen 0-20 — ideal ~47% bruto con markup 1.9
  let margen = 0;
  if (input.margin_ratio != null && Number.isFinite(input.margin_ratio)) {
    const target = 1 - 1 / 1.9;
    margen = clamp((input.margin_ratio / target) * 20, 0, 20);
    why.push(`margen: ${(input.margin_ratio * 100).toFixed(1)}% → ${margen}/20`);
  } else if (input.has_verified_cost) {
    margen = 8;
    why.push("margen: costo verificado + markup default (proyección) → 8/20");
  } else {
    why.push("margen: PRECIO_NO_VERIFICADO → 0/20");
  }

  // Abastecimiento 0-15
  let abastecimiento = 0;
  if (input.match_type === "EXACTO" && input.stock_verified) {
    abastecimiento = 15;
    why.push("abastecimiento: MATCH EXACTO + stock verificado → 15/15");
  } else if (input.match_type === "EXACTO") {
    abastecimiento = 10;
    why.push("abastecimiento: MATCH EXACTO + STOCK_NO_VERIFICADO → 10/15");
  } else if (input.match_type === "EQUIVALENTE" && input.stock_verified) {
    abastecimiento = 9;
    why.push("abastecimiento: equivalente + stock verificado → 9/15");
  } else if (input.match_type === "EQUIVALENTE") {
    abastecimiento = 5;
    why.push("abastecimiento: equivalente + STOCK_NO_VERIFICADO → 5/15");
  } else if (input.coverage_ratio != null && input.coverage_ratio > 0) {
    abastecimiento = clamp(input.coverage_ratio * 8, 0, 8);
    why.push(`abastecimiento: cobertura ${(input.coverage_ratio * 100).toFixed(0)}% → ${abastecimiento}/15`);
  } else if (input.match_type === "NO MATCH") {
    why.push("abastecimiento: NO MATCH → 0/15");
  } else {
    why.push("abastecimiento: NO VERIFICADO → 0/15");
  }

  // Capital 0-10
  let capital = 0;
  if (
    input.capital_requerido != null &&
    input.capital_libre != null &&
    input.capital_requerido > 0
  ) {
    const ratio = input.capital_libre / input.capital_requerido;
    if (ratio >= 2) capital = 10;
    else if (ratio >= 1) capital = 7;
    else if (ratio >= 0.5) capital = 3;
    else capital = 0;
    why.push(`capital: libre/req=${ratio.toFixed(2)} → ${capital}/10`);
  } else {
    why.push("capital: NO VERIFICADO → 0/10");
  }

  // Cobro 0-15
  let cobro = 0;
  if (input.cobro_firmes === true) {
    cobro = 15;
    why.push("cobro: CxC firmes → 15/15");
  } else if (input.cobro_days != null && Number.isFinite(input.cobro_days)) {
    if (input.cobro_days <= 30) cobro = 12;
    else if (input.cobro_days <= 60) cobro = 8;
    else if (input.cobro_days <= 90) cobro = 4;
    else cobro = 1;
    why.push(`cobro: COBRO_ESTIMADO ${input.cobro_days}d → ${cobro}/15`);
  } else {
    why.push("cobro: COBRO_ESTIMADO sin dato → 0/15");
  }

  // Probabilidad 0-10
  let probabilidad = 0;
  if (input.win_probability != null && Number.isFinite(input.win_probability)) {
    probabilidad = clamp(input.win_probability * 10, 0, 10);
    why.push(`probabilidad: ${(input.win_probability * 100).toFixed(0)}% → ${probabilidad}/10`);
  } else {
    why.push("probabilidad: NO VERIFICADO → 0/10");
  }

  // Historial 0-10
  let historial = 0;
  if (input.historial_score != null && Number.isFinite(input.historial_score)) {
    historial =
      input.historial_score <= 1
        ? clamp(input.historial_score * 10, 0, 10)
        : clamp(input.historial_score, 0, 10);
    why.push(`historial: ${historial}/10`);
  } else {
    why.push("historial: NO VERIFICADO → 0/10");
  }

  const raw = encaje + margen + abastecimiento + capital + cobro + probabilidad + historial;
  const total = clamp(raw);
  const band = scoreBand(total);
  why.push(`total ${total} → banda ${band}`);

  return {
    encaje,
    margen,
    abastecimiento,
    capital,
    cobro,
    probabilidad,
    historial,
    total,
    band,
    why,
  };
}
