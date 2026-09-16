/**
 * RESUMEN EJECUTIVO + CHECKLIST DE PRESENTACIÓN — solo desde extract/DB real.
 * Nunca inventa campos: ausente → NO VERIFICADO / PENDIENTE / BLOQUEA.
 */
import { LABEL_NO_VERIFICADO } from "../constants.js";
import { extractPliego, nv, type PliegoExtract } from "./pliegoExtract.js";

const NV = LABEL_NO_VERIFICADO;

export type ResumenEjecutivo = {
  titulo: string;
  organismo: string;
  external_id: string;
  cierre: string;
  apertura: string;
  items_count: number;
  productos: Array<{
    line_no: number;
    product: string;
    qty: string;
    brand: string;
    model: string;
    specs: string;
  }>;
  delivery: string;
  warranty: string;
  docs_required: string[];
  special_conditions: string[];
  rejection_risks: string[];
  mandatory_reqs: string[];
  bid_scope: string;
  lines_to_quote: string;
  extract_status: PliegoExtract["status"];
  verification: typeof LABEL_NO_VERIFICADO;
  note: string;
};

export type ChecklistStatus = "OK" | "PENDIENTE" | "NO VERIFICADO" | "BLOQUEA";

export type ChecklistItem = {
  id: string;
  label: string;
  status: ChecklistStatus;
  detail: string;
};

export type ChecklistPresentacion = {
  items: ChecklistItem[];
  blocks_presentation: boolean;
  verification: typeof LABEL_NO_VERIFICADO;
  note: string;
};

export type OppContext = {
  title?: string;
  organism?: string;
  external_id?: string;
  cierre_at?: string;
  pliego_url?: string;
  pliego_file?: string;
  bid_scope?: string;
  stock_verified?: boolean | number;
  cost_verified_any?: boolean;
};

export function buildResumenEjecutivo(
  extract: PliegoExtract,
  opp: OppContext = {}
): ResumenEjecutivo {
  const cierre = nv(extract.cierre || opp.cierre_at || null);
  return {
    titulo: opp.title || NV,
    organismo: opp.organism || NV,
    external_id: opp.external_id || NV,
    cierre,
    apertura: nv(extract.apertura),
    items_count: extract.items.length,
    productos: extract.items.map((it) => ({
      line_no: it.line_no,
      product: it.product || NV,
      qty: it.qty != null ? String(it.qty) : NV,
      brand: it.brand || NV,
      model: it.model || NV,
      specs: it.specs || NV,
    })),
    delivery: nv(extract.delivery),
    warranty: nv(extract.warranty),
    docs_required: extract.docs_required.length ? extract.docs_required : [NV],
    special_conditions: extract.special_conditions.length
      ? extract.special_conditions
      : [NV],
    rejection_risks: extract.rejection_risks.length ? extract.rejection_risks : [NV],
    mandatory_reqs: extract.mandatory_reqs.length ? extract.mandatory_reqs : [NV],
    bid_scope: nv(extract.bid_scope || opp.bid_scope || null),
    lines_to_quote:
      extract.lines_to_quote != null ? String(extract.lines_to_quote) : NV,
    extract_status: extract.status,
    verification: NV,
    note:
      extract.status === "OK"
        ? "Resumen anclado al texto del pliego — campos sin evidencia = NO VERIFICADO"
        : extract.notes,
  };
}

function item(
  id: string,
  label: string,
  status: ChecklistStatus,
  detail: string
): ChecklistItem {
  return { id, label, status, detail };
}

export function buildChecklistPresentacion(
  extract: PliegoExtract,
  opp: OppContext = {}
): ChecklistPresentacion {
  const hasPliegoLink = Boolean(opp.pliego_url || opp.pliego_file);
  const hasText = extract.status !== "SIN_DOCUMENTO";
  const items: ChecklistItem[] = [];

  items.push(
    item(
      "pliego_link",
      "Pliego descargable (URL/archivo)",
      hasPliegoLink ? "OK" : "BLOQUEA",
      hasPliegoLink
        ? String(opp.pliego_url || opp.pliego_file)
        : "Sin pliego_url/pliego_file — no usar solo 'fuente' como descarga"
    )
  );

  items.push(
    item(
      "pliego_leido",
      "Texto de pliego disponible para extract",
      hasText ? "OK" : "PENDIENTE",
      hasText ? extract.notes : "Adjuntar/pegar texto o PDF extract — sin inventar"
    )
  );

  items.push(
    item(
      "renglones",
      "Renglones / productos / cantidades",
      extract.items.length
        ? "OK"
        : hasText
          ? "NO VERIFICADO"
          : "PENDIENTE",
      extract.items.length
        ? `${extract.items.length} renglón(es) anclados a patrones del documento`
        : "Sin líneas confiables — NO inventar desde el título"
    )
  );

  const brands = extract.items.filter((i) => i.brand).length;
  items.push(
    item(
      "marcas_modelos",
      "Marcas / modelos en renglones",
      brands > 0 ? "OK" : extract.items.length ? "NO VERIFICADO" : "PENDIENTE",
      brands > 0
        ? `${brands}/${extract.items.length} con marca detectada en texto`
        : NV
    )
  );

  const cierreOk = Boolean(extract.cierre || opp.cierre_at);
  items.push(
    item(
      "cierre",
      "Fecha/hora de cierre o apertura-límite",
      cierreOk ? "OK" : "NO VERIFICADO",
      nv(extract.cierre || opp.cierre_at || null)
    )
  );

  items.push(
    item(
      "entrega",
      "Plazo / lugar de entrega",
      extract.delivery ? "OK" : "NO VERIFICADO",
      nv(extract.delivery)
    )
  );

  items.push(
    item(
      "garantia",
      "Garantía (mantenimiento de oferta / contrato)",
      extract.warranty ? "OK" : "NO VERIFICADO",
      nv(extract.warranty)
    )
  );

  items.push(
    item(
      "docs",
      "Documentación exigida",
      extract.docs_required.length ? "OK" : "NO VERIFICADO",
      extract.docs_required.length ? extract.docs_required.join(" · ") : NV
    )
  );

  items.push(
    item(
      "condiciones",
      "Condiciones especiales / modalidad",
      extract.special_conditions.length || extract.bid_scope || opp.bid_scope
        ? "OK"
        : "NO VERIFICADO",
      [
        extract.bid_scope || opp.bid_scope || "",
        ...extract.special_conditions,
      ]
        .filter(Boolean)
        .join(" · ") || NV
    )
  );

  items.push(
    item(
      "rechazo",
      "Riesgos / causales de rechazo",
      extract.rejection_risks.length ? "OK" : "NO VERIFICADO",
      extract.rejection_risks.length ? extract.rejection_risks.join(" · ") : NV
    )
  );

  items.push(
    item(
      "mandatory",
      "Requisitos obligatorios detectados",
      extract.mandatory_reqs.length ? "OK" : "NO VERIFICADO",
      extract.mandatory_reqs.length ? extract.mandatory_reqs.join(" · ") : NV
    )
  );

  const bid = extract.bid_scope || opp.bid_scope || "";
  items.push(
    item(
      "bid_scope",
      "BID_SCOPE (total / renglón / lote)",
      bid ? "OK" : "BLOQUEA",
      bid || "UNKNOWN — bloquear presentación hasta confirmar modalidad"
    )
  );

  items.push(
    item(
      "precios",
      "Costos / precios de compra",
      opp.cost_verified_any ? "OK" : "NO VERIFICADO",
      opp.cost_verified_any ? "Al menos un costo verificado en DB" : "PRECIO_NO_VERIFICADO"
    )
  );

  items.push(
    item(
      "stock",
      "Stock verificado",
      opp.stock_verified ? "OK" : "NO VERIFICADO",
      opp.stock_verified ? "STOCK_VERIFICADO" : "STOCK_NO_VERIFICADO"
    )
  );

  items.push(
    item(
      "humano",
      "Aprobación humana antes de presentar",
      "PENDIENTE",
      "Sin auto-bid / auto-presentación — requiere APROBAR de Mariano"
    )
  );

  const blocks = items.some((i) => i.status === "BLOQUEA");
  return {
    items,
    blocks_presentation: blocks,
    verification: NV,
    note: blocks
      ? "Hay ítems BLOQUEA — no presentar hasta resolver"
      : "Checklist generado solo con evidencia; no inventa cumplimientos",
  };
}

/** One-shot: text → extract + resumen + checklist */
export function analyzePliegoText(text: string, opp: OppContext = {}) {
  const extract = extractPliego(text);
  return {
    extract,
    resumen_ejecutivo: buildResumenEjecutivo(extract, opp),
    checklist_presentacion: buildChecklistPresentacion(extract, opp),
  };
}
