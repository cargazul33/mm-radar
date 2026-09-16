export type BottleneckInput = {
  open_opps: number;
  closing_24h: number;
  missing_stock: number;
  won_without_buy: number;
  overdue_collections: number;
  capital_libre: number;
  cotizando: number;
  sin_pliego: number;
  skipped_hard: number;
};

export type BottleneckResult = {
  bottleneck: string;
  text: string;
  secondary: string[];
};

/**
 * Detector de cuello de botella a partir de estado real de DB.
 * Texto en español, sin inventar causas.
 */
export function detectBottleneck(s: BottleneckInput): BottleneckResult {
  const hits: Array<{ key: string; w: number; text: string }> = [];

  if (s.overdue_collections > 0) {
    hits.push({
      key: "cobranzas",
      w: 100 + s.overdue_collections * 10,
      text: `Cuello: cobranzas vencidas (${s.overdue_collections}). El capital no vuelve a caja.`,
    });
  }
  if (s.won_without_buy > 0) {
    hits.push({
      key: "compra",
      w: 90 + s.won_without_buy * 10,
      text: `Cuello: ops ganadas sin compra (${s.won_without_buy}). No hay auto-buy: hay que comprar a mano.`,
    });
  }
  if (s.missing_stock > 0) {
    hits.push({
      key: "stock",
      w: 80 + s.missing_stock * 5,
      text: `Cuello: stock no verificado / faltante en ${s.missing_stock} oportunidad(es). STOCK_NO_VERIFICADO bloquea ofertar en firme.`,
    });
  }
  if (s.capital_libre <= 0 && (s.cotizando > 0 || s.won_without_buy > 0)) {
    hits.push({
      key: "capital",
      w: 85,
      text: "Cuello: capital operativo real ≤ 0. No hay libre para comprar. No contar cotizaciones como caja.",
    });
  }
  if (s.closing_24h > 0) {
    hits.push({
      key: "tiempo",
      w: 70 + s.closing_24h * 8,
      text: `Cuello: ${s.closing_24h} cierre(s) en <24h. Capacidad de cotizar a tiempo.`,
    });
  }
  if (s.sin_pliego > 0) {
    hits.push({
      key: "pliego",
      w: 40 + s.sin_pliego,
      text: `Cuello: ${s.sin_pliego} oportunidad(es) sin pliego descargable.`,
    });
  }
  if (s.open_opps === 0) {
    hits.push({
      key: "pipeline",
      w: 30,
      text: "Cuello: pipeline vacío. No hay oportunidades cargadas (no se inventan). Importar o agregar con URL oficial.",
    });
  }

  hits.sort((a, b) => b.w - a.w);
  if (!hits.length) {
    return {
      bottleneck: "ninguno_detectado",
      text: "Sin cuello de botella detectado en el estado actual de la DB. Metas $40M/$10M son aspiracionales; el progreso solo cuenta datos reales.",
      secondary: [],
    };
  }
  return {
    bottleneck: hits[0].key,
    text: hits[0].text,
    secondary: hits.slice(1, 3).map((h) => h.text),
  };
}
