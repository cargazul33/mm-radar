import type { MatchType } from "../constants.js";
import { LABEL_STOCK_NO_VERIFICADO } from "../constants.js";

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Match proveedor/producto: EXACTO solo si proven (desc + marca + modelo cuando existen).
 * EQUIVALENTE / NO MATCH en el resto. Nunca inventar stock.
 */
export function classifyMatch(opts: {
  requested: string;
  offered: string;
  brandRequested?: string;
  brandOffered?: string;
  modelRequested?: string;
  modelOffered?: string;
  provenExact?: boolean;
}): { match_type: MatchType; why: string } {
  if (opts.provenExact === true) {
    return { match_type: "EXACTO", why: "MATCH EXACTO provenido por evidencia verificada" };
  }

  const req = norm(opts.requested);
  const off = norm(opts.offered);
  if (!req || !off) {
    return { match_type: "NO MATCH", why: "texto vacío — NO VERIFICADO" };
  }

  const hasBrandReq = !!(opts.brandRequested && opts.brandRequested.trim());
  const hasModelReq = !!(opts.modelRequested && opts.modelRequested.trim());
  const brandOk =
    !hasBrandReq ||
    (!!opts.brandOffered && norm(opts.brandRequested!) === norm(opts.brandOffered));
  const modelOk =
    !hasModelReq ||
    (!!opts.modelOffered && norm(opts.modelRequested!) === norm(opts.modelOffered));

  // EXACTO solo si descripción idéntica Y (si hay marca/modelo requeridos) coinciden
  if (req === off && brandOk && modelOk && (hasBrandReq || hasModelReq || req.length >= 8)) {
    return { match_type: "EXACTO", why: "descripción/marca/modelo idénticos (probado)" };
  }

  const reqTokens = new Set(req.split(" ").filter((t) => t.length > 2));
  const offTokens = off.split(" ").filter((t) => t.length > 2);
  const overlap = offTokens.filter((t) => reqTokens.has(t)).length;
  const ratio = reqTokens.size ? overlap / reqTokens.size : 0;

  if ((req.includes(off) || off.includes(req)) && brandOk) {
    return { match_type: "EQUIVALENTE", why: "contención de texto + marca ok (no EXACTO)" };
  }
  if (ratio >= 0.6 && brandOk) {
    return { match_type: "EQUIVALENTE", why: `solapamiento tokens ${(ratio * 100).toFixed(0)}% (no EXACTO)` };
  }

  return { match_type: "NO MATCH", why: "sin equivalencia verificable" };
}

export function stockVerifiedFlag(stock: number | null | undefined, verified: boolean): {
  stock: number | null;
  stock_verified: boolean;
  stock_label: string;
} {
  if (!verified || stock == null) {
    return {
      stock: null,
      stock_verified: false,
      stock_label: LABEL_STOCK_NO_VERIFICADO,
    };
  }
  return { stock, stock_verified: true, stock_label: "STOCK_VERIFICADO" };
}
