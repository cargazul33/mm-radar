/**
 * Deterministic pliego text extract — port of mm-ai-commerce extractors/pliego_lines + meta fields.
 * NEVER invents products/qty/prices. Missing fields → null / empty + verification NO VERIFICADO.
 * Python commerce parsers are not importable in Workers; patterns mirrored here.
 */
import { LABEL_NO_VERIFICADO } from "../constants.js";

export type PliegoLineItem = {
  line_no: number;
  product: string;
  qty: number | null;
  unit: string;
  brand: string;
  model: string;
  specs: string;
  verification: typeof LABEL_NO_VERIFICADO;
  source_pattern: string;
};

export type PliegoExtract = {
  status: "OK" | "SIN_DOCUMENTO" | "SIN_LINEAS";
  items: PliegoLineItem[];
  cierre: string | null;
  apertura: string | null;
  delivery: string | null;
  warranty: string | null;
  docs_required: string[];
  special_conditions: string[];
  rejection_risks: string[];
  mandatory_reqs: string[];
  bid_scope: string | null;
  lines_to_quote: number | null;
  verification: typeof LABEL_NO_VERIFICADO;
  notes: string;
  source: "text";
};

const BRAND_RE =
  /\b(HP|Dell|Lenovo|Epson|Brother|Cisco|Samsung|LG|Acer|Canon|Logitech|TP-?LINK|TP\s*Link|GLC|Glc|ZOLODA|LYONN|Omada|Atomlux|Wi-?Tek|WiTek|Meraki|Ericsson|PowerFiber|Katech)\b/i;

const SKIP_LINE =
  /^(re\s+cant|cantidad de renglones|total cotizado|marca ofrecida|mantenimiento de oferta|forma de pago|plazo de entrega|referencias|safipro|página|pagina|cuit:|descripcion\s*$|pedido de presupuesto|plieg-|ministerio de |naturales\s*$|sol\s+ofr|per cant)/i;

const SAFIPRO_ROW =
  /^\s*(?<ren>\d{1,3})\s+(?<qty>\d+[.,]?\d*)\s+(?<product>[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚáéíóúÑñÜü0-9 /&\-.\(\)\+:@°×,]{2,}(?:;.*)?)\s*$/gm;

const NUMBERED_QTY =
  /^\s*(?<ren>\d{1,3})[).\-]\s*(?<qty>\d+[.,]?\d*)\s*(?<unit>u\.?|unidades?|kits?|cajas?|resmas?|jg|juegos?|packs?)?\s*(?:de\s+)?(?<product>.+?)\s*$/gim;

const ITEM_LABEL =
  /^\s*(?:ítem|item|rengl[oó]n)\s*(?<ren>\d{1,3})\s*[:\-]\s*(?<qty>\d+[.,]?\d*)?\s*(?<unit>u\.?|unidades?)?\s*(?<product>.+?)\s*$/gim;

const NV = LABEL_NO_VERIFICADO;

function parseQty(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanProduct(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\$\s*$/, "").trim().slice(0, 500);
}

function brandFrom(text: string): string {
  const sug = text.match(
    /marca\s+sugerida\s*:\s*(?!ninguna)(TP-?Link|Atomlux|GLC|Glc|Wi-?Tek|Cisco|Ericsson|Omada|Meraki|PowerFiber)/i
  );
  if (sug) return sug[1];
  const m = text.match(BRAND_RE);
  return m ? m[1] : "";
}

function modelFrom(text: string): string {
  // Conservative SKU-like tokens (FO-4075, LIC-MR-E, X343, etc.) — only if pattern matches
  const m = text.match(
    /\b([A-Z]{1,4}-?[A-Z0-9]{2,6}(?:-[A-Z0-9]{1,6})?|\bFO[- ]?\d{3,5}|\bLIC-MR-[A-Z]\b)\b/i
  );
  return m ? m[1].replace(/\s+/g, "") : "";
}

function finalize(it: Omit<PliegoLineItem, "verification"> & { verification?: string }): PliegoLineItem {
  return {
    ...it,
    brand: it.brand || brandFrom(it.specs || it.product),
    model: it.model || modelFrom(it.specs || it.product),
    verification: NV,
  };
}

function flattenSafipro(text: string): string {
  const lines = text.replace(/\x0c/g, "\n").split(/\r?\n/);
  const out: string[] = [];
  let buf = "";
  const rowStart = /^\s*\d{1,3}\s+\d+[.,]?\d*\s+[A-ZÁÉÍÓÚÑÜ]/;
  const pageNoise =
    /^(página|pagina|plieg-|safipro|ministerio de |naturales\s*$|re\s+cant|sol\s+ofr|per cant|ofr ofr|unitario|total\s*$)/i;

  const incomplete = (b: string) =>
    !!b &&
    (/(especificaci[oó]n|adicional:?|marca sugerida:?|tipo\s*)$/i.test(b.trim()) ||
      b.trim().endsWith("-") ||
      b.trim().endsWith(";"));

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const stripped = line.trim();
    if (!stripped) {
      if (buf && !incomplete(buf)) {
        out.push(buf);
        buf = "";
      }
      continue;
    }
    if (SKIP_LINE.test(stripped) || pageNoise.test(stripped) || /^página\s+\d+/i.test(stripped)) {
      continue;
    }
    if (rowStart.test(line)) {
      if (buf) out.push(buf);
      buf = stripped;
      continue;
    }
    if (stripped.startsWith("$")) continue;
    if (/^marca ofrecida/i.test(stripped)) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      continue;
    }
    if (
      buf &&
      (line.startsWith(" ") ||
        line.startsWith("\t") ||
        incomplete(buf) ||
        /^adicional:/i.test(stripped))
    ) {
      buf = `${buf} ${stripped}`;
      continue;
    }
    if (buf) {
      out.push(buf);
      buf = "";
    }
    out.push(stripped);
  }
  if (buf) out.push(buf);
  return out.join("\n");
}

function fromSafipro(text: string): PliegoLineItem[] {
  const items = new Map<number, PliegoLineItem & { _has_semi?: boolean }>();
  const legalese = [
    "ley ",
    "decreto",
    "artículo",
    "articulo",
    "en caso",
    "el nombre",
    "se comunica",
    "saludo",
    "página",
    "pagina",
    "plazo de",
    "forma de pago",
    "mantenimiento de oferta",
    "cantidad de renglones",
  ];
  SAFIPRO_ROW.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SAFIPRO_ROW.exec(text))) {
    const ren = Number(m.groups?.ren);
    const qty = parseQty(m.groups?.qty);
    const product = cleanProduct(m.groups?.product || "");
    if (!ren || qty == null || product.length < 3) continue;
    const low = product.toLowerCase();
    if (legalese.some((x) => low.startsWith(x))) continue;
    const hasSemi = product.includes(";");
    const cand: PliegoLineItem & { _has_semi?: boolean } = {
      line_no: ren,
      product: product.split(";")[0].trim().slice(0, 200),
      qty,
      unit: "u",
      brand: brandFrom(product),
      model: modelFrom(product),
      specs: product,
      verification: NV,
      source_pattern: "safipro_row",
      _has_semi: hasSemi,
    };
    const prev = items.get(ren);
    if (!prev || (hasSemi && !prev._has_semi)) items.set(ren, cand);
  }
  return [...items.values()]
    .sort((a, b) => a.line_no - b.line_no)
    .map(({ _has_semi, ...rest }) => finalize(rest));
}

function fromNumbered(text: string): PliegoLineItem[] {
  const seen = new Set<number>();
  const items: PliegoLineItem[] = [];
  NUMBERED_QTY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBERED_QTY.exec(text))) {
    const ren = Number(m.groups?.ren);
    if (seen.has(ren)) continue;
    const qty = parseQty(m.groups?.qty);
    const product = cleanProduct(m.groups?.product || "");
    if (qty == null || product.length < 5) continue;
    seen.add(ren);
    items.push(
      finalize({
        line_no: ren,
        product: product.slice(0, 200),
        qty,
        unit: (m.groups?.unit || "u").slice(0, 16) || "u",
        brand: brandFrom(product),
        model: modelFrom(product),
        specs: product,
        source_pattern: "numbered_qty",
      })
    );
  }
  return items.sort((a, b) => a.line_no - b.line_no);
}

function fromItemLabel(text: string): PliegoLineItem[] {
  const seen = new Set<number>();
  const items: PliegoLineItem[] = [];
  ITEM_LABEL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ITEM_LABEL.exec(text))) {
    const ren = Number(m.groups?.ren);
    if (seen.has(ren)) continue;
    const qty = parseQty(m.groups?.qty); // null if missing — do NOT invent 1
    const product = cleanProduct(m.groups?.product || "");
    if (product.length < 5 || qty == null) continue;
    seen.add(ren);
    items.push(
      finalize({
        line_no: ren,
        product: product.slice(0, 200),
        qty,
        unit: (m.groups?.unit || "u").slice(0, 16) || "u",
        brand: brandFrom(product),
        model: modelFrom(product),
        specs: product,
        source_pattern: "item_label",
      })
    );
  }
  return items.sort((a, b) => a.line_no - b.line_no);
}

/** Extract line items — empty if nothing reliable. Never invent from title. */
export function extractLineItems(text: string, maxItems = 40): PliegoLineItem[] {
  if (!text || !text.trim()) return [];
  const flat = flattenSafipro(text);
  let found = fromSafipro(flat);
  if (found.length) return found.slice(0, maxItems);
  found = fromNumbered(text);
  if (found.length) return found.slice(0, maxItems);
  found = fromItemLabel(text);
  return found.slice(0, maxItems);
}

function clipMatch(text: string, re: RegExp, max = 220): string | null {
  const m = text.match(re);
  if (!m) return null;
  return (m[1] || m[0]).replace(/\s+/g, " ").trim().slice(0, max) || null;
}

function uniqueSnippets(matches: string[], max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const s = raw.replace(/\s+/g, " ").trim().slice(0, 240);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function extractMeta(text: string): Omit<
  PliegoExtract,
  "status" | "items" | "verification" | "notes" | "source"
> {
  const raw = text || "";
  const low = raw.toLowerCase();

  const apertura =
    clipMatch(
      raw,
      /Apertura\s+de\s+Propuestas?\s*:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}(?:\s+HORA:\s*[0-9]{1,2}:[0-9]{2})?)/i
    ) ||
    clipMatch(raw, /fecha\s+de\s+apertura\s*:\s*([^\n]{5,80})/i);

  const cierre =
    clipMatch(raw, /cierre\s*(?:de\s+(?:ofertas?|propuestas?))?\s*:\s*([^\n]{5,80})/i) ||
    clipMatch(raw, /presentaci[oó]n\s+hasta\s*:\s*([^\n]{5,80})/i) ||
    // CODINEU often uses apertura as deadline for offers
    (apertura ? `hasta apertura: ${apertura}` : null);

  const delivery =
    clipMatch(raw, /(?:plazo\s+de\s+entrega|entrega)\s*:\s*([^\n]{5,160})/i) ||
    clipMatch(raw, /(destino\s*:\s*[^\n]{5,160})/i);

  const warranty =
    clipMatch(
      raw,
      /(garant[ií]a(?:\s+de\s+mantenimiento\s+de\s+oferta)?[^\n.]{0,160}\.)/i
    ) ||
    clipMatch(raw, /(importe\s+igual\s+al\s+diez\s+por\s+ciento[^\n.]{0,120})/i) ||
    clipMatch(raw, /(Art[ií]culo\s+\d+°?:\s*Garant[ií]as?[^\n]{0,120})/i);

  const docs: string[] = [];
  const docRes = [
    /certificado[s]?\s+de\s+[“"]?producto\s+neuquino[”"]?/gi,
    /certificado[s]?\s+de\s+cumplimiento\s+fiscal/gi,
    /garant[ií]a\s+de\s+mantenimiento\s+de\s+oferta/gi,
    /documentaci[oó]n\s+firmada/gi,
    /constancia\s+de\s+inscripci[oó]n\s+(?:en\s+)?co\.?di\.?neu/gi,
    /sellado\s+de\s+ley/gi,
  ];
  for (const re of docRes) {
    const m = raw.match(re);
    if (m) docs.push(...m.map((x) => x.replace(/\s+/g, " ").trim()));
  }

  const special: string[] = [];
  const spRes = [
    /oferta\s+total\s+obligatoria[^\n.]{0,80}/gi,
    /no\s+se\s+aceptar[aá]n?\s+ofertas?\s+parciales?[^\n.]{0,80}/gi,
    /cantidad\s+de\s+renglones\s+a\s+cotizar\s*:\s*\d+/gi,
    /precio\s+unitario\s+y\s+total\s+de\s+cada\s+rengl[oó]n[^\n.]{0,60}/gi,
    /mantenimiento\s+de\s+oferta[^\n.]{0,100}/gi,
  ];
  for (const re of spRes) {
    const m = raw.match(re);
    if (m) special.push(...m.map((x) => x.replace(/\s+/g, " ").trim()));
  }

  const risks: string[] = [];
  const riskRes = [
    /falta\s+de\s+documento\s+de\s+garant[ií]a[^\n.]{0,100}/gi,
    /falta\s+de\s+firma\s+del\s+proponente[^\n.]{0,100}/gi,
    /documento\s+de\s+garant[ií]a\s+insuficiente[^\n.]{0,100}/gi,
    /causales?\s+de\s+rechazo[^\n.]{0,120}/gi,
    /rechazo\s+autom[aá]tico[^\n.]{0,100}/gi,
    /falta\s+o\s+insuficiencia\s+de\s+(?:las\s+)?garant[ií]as?[^\n.]{0,80}/gi,
  ];
  for (const re of riskRes) {
    const m = raw.match(re);
    if (m) risks.push(...m.map((x) => x.replace(/\s+/g, " ").trim()));
  }

  const mandatory: string[] = [];
  const mandRes = [
    /deber[aá]\s+cotizar\s+(?:la\s+)?(?:totalidad|todos\s+los\s+renglones)[^\n.]{0,80}/gi,
    /cantidad\s+de\s+renglones\s+a\s+cotizar\s*:\s*\d+/gi,
    /garant[ií]a\s+de\s+mantenimiento\s+de\s+oferta/gi,
    /presentaci[oó]n\s+(?:en|mediante)\s+plataforma[^\n.]{0,80}/gi,
    /firma\s+(?:del\s+)?(?:proponente|oferente)[^\n.]{0,60}/gi,
  ];
  for (const re of mandRes) {
    const m = raw.match(re);
    if (m) mandatory.push(...m.map((x) => x.replace(/\s+/g, " ").trim()));
  }

  let linesToQuote: number | null = null;
  const lq = low.match(/cantidad de renglones a cotizar\s*:\s*(\d+)/);
  if (lq) linesToQuote = Number(lq[1]);

  let bidScope: string | null = null;
  if (/adjudicaci[oó]n\s+por\s+rengl[oó]n/i.test(raw)) bidScope = "ITEM_LEVEL_ALLOWED";
  else if (/adjudicaci[oó]n\s+por\s+(grupo|lote)/i.test(raw)) bidScope = "LOT_LEVEL_ALLOWED";
  else if (
    linesToQuote != null ||
    /oferta\s+total\s+obligatoria|no\s+se\s+aceptar[aá]n?\s+ofertas?\s+parciales?/i.test(raw)
  ) {
    bidScope = "TOTAL_REQUIRED";
  } else if (/precio unitario y total de\s+cada rengl[oó]n/i.test(raw)) {
    bidScope = "TOTAL_REQUIRED"; // quote each line + typically all lines
  }

  return {
    cierre,
    apertura,
    delivery,
    warranty,
    docs_required: uniqueSnippets(docs),
    special_conditions: uniqueSnippets(special),
    rejection_risks: uniqueSnippets(risks),
    mandatory_reqs: uniqueSnippets(mandatory),
    bid_scope: bidScope,
    lines_to_quote: linesToQuote,
  };
}

/** Full extract from pliego text. Empty text → SIN_DOCUMENTO, never invent items. */
export function extractPliego(text: string): PliegoExtract {
  if (!text || !text.trim()) {
    return {
      status: "SIN_DOCUMENTO",
      items: [],
      cierre: null,
      apertura: null,
      delivery: null,
      warranty: null,
      docs_required: [],
      special_conditions: [],
      rejection_risks: [],
      mandatory_reqs: [],
      bid_scope: null,
      lines_to_quote: null,
      verification: NV,
      notes: "sin_documento; no_inventar",
      source: "text",
    };
  }
  const items = extractLineItems(text);
  const meta = extractMeta(text);
  if (!items.length) {
    return {
      status: "SIN_LINEAS",
      items: [],
      ...meta,
      verification: NV,
      notes: "sin_lineas_confiables_en_documento; no_inventar",
      source: "text",
    };
  }
  const patterns = [...new Set(items.map((i) => i.source_pattern))].join(",");
  return {
    status: "OK",
    items,
    ...meta,
    verification: NV,
    notes: `extracted=${items.length}; patterns=${patterns}`,
    source: "text",
  };
}

/** Display helper: null/empty → NO VERIFICADO */
export function nv(value: string | null | undefined): string {
  if (value == null || String(value).trim() === "") return NV;
  return String(value);
}
