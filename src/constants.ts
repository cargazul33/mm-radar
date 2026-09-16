/** Constantes de negocio M&M RADAR — nunca inventar datos. */
export const MARKUP_DEFAULT = 1.9;
export const META_VENTAS_MENSUAL = 40_000_000;
export const META_GANANCIA_MENSUAL = 10_000_000;
export const HARD_SKIP_CODINEU_IDS = new Set(["16514"]);
export const LABEL_NO_VERIFICADO = "NO VERIFICADO";
export const LABEL_STOCK_NO_VERIFICADO = "STOCK_NO_VERIFICADO";
export const LABEL_PRECIO_NO_VERIFICADO = "PRECIO_NO_VERIFICADO";
export const LABEL_COBRO_ESTIMADO = "COBRO_ESTIMADO";
export const APP_TZ = "America/Argentina/Buenos_Aires";

/** Pipeline completo ops (MVP). */
export const PIPELINE = [
  "DETECTADA",
  "NUEVA", // alias legacy → tratar como DETECTADA
  "ANALISIS",
  "BUSCANDO_PROVEEDOR",
  "COTIZANDO",
  "LISTA_PARA_PRESENTAR",
  "PRESENTADA",
  "OPS_GANADA",
  "COMPRANDO",
  "ENTREGANDO",
  "FACTURANDO",
  "COBRANDO",
  "COBRADA",
  "COBRADO", // alias legacy
  "DESCARTADA",
  "PERDIDA",
  "SKIPPED_HARD",
] as const;

export type PipelineState = (typeof PIPELINE)[number];

export const MATCH_TYPES = ["EXACTO", "EQUIVALENTE", "NO MATCH"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const COBRANZA_STATES = [
  "PENDIENTE",
  "PARCIAL",
  "VENCIDA",
  "EN_GESTION",
  "COBRADA",
  "INCOBRABLE",
] as const;

export type CobranzaState = (typeof COBRANZA_STATES)[number];

/** Bandas Score M&M (spec producto). */
export const SCORE_BANDS = [
  { min: 75, max: 100, band: "ATACAR", color: "#16a34a" },
  { min: 55, max: 74, band: "COTIZAR", color: "#2563eb" },
  { min: 35, max: 54, band: "REVISAR", color: "#ca8a04" },
  { min: 0, max: 34, band: "DESCARTAR", color: "#dc2626" },
] as const;

/** Rubros prioritarios / deprioritarios (texto libre CODINEU). */
export const RUBROS_PRIORITARIOS = [
  "hardware",
  "informatica",
  "informática",
  "computacion",
  "computación",
  "redes",
  "oficina",
  "libreria",
  "librería",
  "electronica",
  "electrónica",
  "electro",
  "telefonia",
  "telefonía",
  "herramientas",
  "electricidad",
  "aire acondicionado",
  "aa ",
  " a/a",
  "insumos de oficina",
  "it",
];

export const RUBROS_DEPRIORITARIOS = [
  "salud",
  "medico",
  "médico",
  "farmacia",
  "policia",
  "policía",
  "seguridad publica",
  "seguridad pública",
  "construccion pesada",
  "construcción pesada",
  "obra publica",
  "obra pública",
  "hormigon",
  "hormigón",
  "pavimento",
];
