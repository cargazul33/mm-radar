import { MARKUP_DEFAULT, LABEL_NO_VERIFICADO, LABEL_PRECIO_NO_VERIFICADO } from "../constants.js";

export type ProfitLine = {
  qty: number;
  unit_cost: number | null;
  cost_verified: boolean;
};

export type ProfitResult = {
  cost_products: number | null;
  cost_shipping: number | null;
  cost_other: number | null;
  cost_total: number | null;
  sell_price: number | null;
  /** alias sell_price for API/DB */
  precio_objetivo: number | null;
  gross: number | null;
  /** alias gross */
  utilidad_estimada: number | null;
  net_estimated: number | null;
  capital: number | null;
  days_locked: number | null;
  roi: number | null;
  capital_efficiency: number | null;
  margin_ratio: number | null;
  markup_used: number;
  verification: string;
  invent_flags: string[];
  label: string;
};

/**
 * Rentabilidad: cost products+shipping+other → total; sell; gross; net estimated;
 * capital; days locked; ROI; capital efficiency.
 * Sin costos verificados → null + PRECIO_NO_VERIFICADO (no inventa).
 */
export function computeProfit(
  lines: ProfitLine[],
  optsOrMarkup:
    | number
    | {
        markup?: number;
        shipping?: number | null;
        shipping_verified?: boolean;
        other?: number | null;
        other_verified?: boolean;
        days_locked?: number | null;
        net_tax_factor?: number; // e.g. 0.85 estimated net after tax — labeled ESTIMACIÓN
      } = {}
): ProfitResult {
  const opts = typeof optsOrMarkup === "number" ? { markup: optsOrMarkup } : optsOrMarkup;
  const markup = opts.markup ?? MARKUP_DEFAULT;
  const invent_flags: string[] = [];
  const empty = (): ProfitResult => ({
    cost_products: null,
    cost_shipping: null,
    cost_other: null,
    cost_total: null,
    sell_price: null,
    precio_objetivo: null,
    gross: null,
    utilidad_estimada: null,
    net_estimated: null,
    capital: null,
    days_locked: opts.days_locked ?? null,
    roi: null,
    capital_efficiency: null,
    margin_ratio: null,
    markup_used: markup,
    verification: LABEL_NO_VERIFICADO,
    invent_flags: invent_flags.length ? [...new Set(invent_flags)] : ["SIN_LINEAS"],
    label: LABEL_PRECIO_NO_VERIFICADO,
  });

  if (!lines.length) return empty();

  let products = 0;
  let allVerified = true;
  for (const line of lines) {
    if (line.unit_cost == null || !line.cost_verified) {
      allVerified = false;
      invent_flags.push(LABEL_PRECIO_NO_VERIFICADO);
      continue;
    }
    products += line.qty * line.unit_cost;
  }

  const ship = opts.shipping ?? 0;
  const other = opts.other ?? 0;
  if (opts.shipping != null && opts.shipping_verified !== true) {
    invent_flags.push("FLETE_NO_VERIFICADO");
    allVerified = false;
  }
  if (opts.other != null && opts.other_verified !== true) {
    invent_flags.push("OTROS_NO_VERIFICADOS");
    allVerified = false;
  }

  if (!allVerified || invent_flags.includes(LABEL_PRECIO_NO_VERIFICADO)) {
    return {
      ...empty(),
      invent_flags: [...new Set(invent_flags)],
    };
  }

  const cost_total = products + ship + other;
  const sell = cost_total * markup;
  const gross = sell - cost_total;
  const taxFactor = opts.net_tax_factor ?? 0.85;
  const net = gross * taxFactor; // ESTIMACIÓN
  const capital = cost_total;
  const days = opts.days_locked ?? null;
  const roi = capital > 0 ? net / capital : null;
  const capital_efficiency = days && days > 0 && roi != null ? roi / (days / 30) : roi;
  const margin_ratio = sell > 0 ? gross / sell : 0;

  return {
    cost_products: round2(products),
    cost_shipping: round2(ship),
    cost_other: round2(other),
    cost_total: round2(cost_total),
    sell_price: round2(sell),
    precio_objetivo: round2(sell),
    gross: round2(gross),
    utilidad_estimada: round2(gross),
    net_estimated: round2(net),
    capital: round2(capital),
    days_locked: days,
    roi: roi != null ? round4(roi) : null,
    capital_efficiency: capital_efficiency != null ? round4(capital_efficiency) : null,
    margin_ratio: round4(margin_ratio),
    markup_used: markup,
    verification: "VERIFICADO",
    invent_flags: [],
    label: "costos verificados; neto = ESTIMACIÓN",
  };
}

export type RankItem = {
  id: string;
  utilidad_estimada: number | null;
  capital_requerido: number | null;
};

/** Ranking por eficiencia de capital: utilidad / capital_requerido (desc). */
export function rankByCapitalEfficiency(items: RankItem[]): Array<
  RankItem & { efficiency: number | null; rank: number; label: string }
> {
  const scored = items.map((it) => {
    if (
      it.utilidad_estimada == null ||
      it.capital_requerido == null ||
      it.capital_requerido <= 0
    ) {
      return { ...it, efficiency: null as number | null, label: LABEL_NO_VERIFICADO };
    }
    return {
      ...it,
      efficiency: it.utilidad_estimada / it.capital_requerido,
      label: "VERIFICADO",
    };
  });

  scored.sort((a, b) => {
    if (a.efficiency == null && b.efficiency == null) return 0;
    if (a.efficiency == null) return 1;
    if (b.efficiency == null) return -1;
    return b.efficiency - a.efficiency;
  });

  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
