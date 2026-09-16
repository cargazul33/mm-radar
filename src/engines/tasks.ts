/**
 * "Qué hago hoy" — priorización urgente / alta / oportunidades.
 * No inventa tareas: solo deriva de datos reales del sistema.
 */

export type TaskPriority = "urgente" | "alta" | "oportunidades";

export type RawSignal = {
  kind:
    | "cierre"
    | "cobranza"
    | "compra"
    | "entrega"
    | "facturacion"
    | "oportunidad"
    | "capital"
    | "stock"
    | "pliego";
  id: string;
  title: string;
  hours_to_event?: number | null;
  mm_score?: number | null;
  amount?: number | null;
  pipeline?: string | null;
  extra?: string;
};

export type TodayTask = {
  priority: TaskPriority;
  action: string;
  ref_id: string;
  title: string;
  reason: string;
  sort_key: number;
};

export function buildQueHagoHoy(signals: RawSignal[]): TodayTask[] {
  const tasks: TodayTask[] = [];

  for (const s of signals) {
    if (s.kind === "cierre" && s.hours_to_event != null && s.hours_to_event >= 0) {
      if (s.hours_to_event <= 24) {
        tasks.push({
          priority: "urgente",
          action: "Cerrar / presentar antes de <24h",
          ref_id: s.id,
          title: s.title,
          reason: `Cierre en ${s.hours_to_event.toFixed(1)}h`,
          sort_key: s.hours_to_event,
        });
      } else if (s.hours_to_event <= 72) {
        tasks.push({
          priority: "alta",
          action: "Preparar presentación (<72h)",
          ref_id: s.id,
          title: s.title,
          reason: `Cierre en ${(s.hours_to_event / 24).toFixed(1)}d`,
          sort_key: 100 + s.hours_to_event,
        });
      }
    }

    if (s.kind === "cobranza") {
      if (s.hours_to_event != null && s.hours_to_event < 0) {
        tasks.push({
          priority: "urgente",
          action: "Cobranza vencida",
          ref_id: s.id,
          title: s.title,
          reason: s.extra || "VENCIDA",
          sort_key: s.hours_to_event,
        });
      } else if (s.hours_to_event != null && s.hours_to_event <= 24) {
        tasks.push({
          priority: "urgente",
          action: "Gestionar cobranza <24h",
          ref_id: s.id,
          title: s.title,
          reason: s.extra || "Vence / compromiso <24h",
          sort_key: s.hours_to_event,
        });
      } else if (s.hours_to_event != null && s.hours_to_event <= 72) {
        tasks.push({
          priority: "alta",
          action: "Seguimiento cobranza <72h",
          ref_id: s.id,
          title: s.title,
          reason: s.extra || "Vence <72h",
          sort_key: 200 + s.hours_to_event,
        });
      }
    }

    if (s.kind === "compra" && (s.pipeline === "OPS_GANADA" || s.pipeline === "COMPRANDO")) {
      tasks.push({
        priority: "alta",
        action: "Comprar insumos (manual — sin auto-buy)",
        ref_id: s.id,
        title: s.title,
        reason: "Ops ganada pendiente de compra",
        sort_key: 300,
      });
    }

    if (s.kind === "stock") {
      tasks.push({
        priority: "urgente",
        action: "Verificar stock / STOCK_NO_VERIFICADO",
        ref_id: s.id,
        title: s.title,
        reason: s.extra || "Stock faltante o no verificado para ofertar",
        sort_key: 50,
      });
    }

    if (s.kind === "pliego") {
      tasks.push({
        priority: "alta",
        action: "Descargar / revisar pliego",
        ref_id: s.id,
        title: s.title,
        reason: s.extra || "Sin pliego adjunto",
        sort_key: 80,
      });
    }

    if (s.kind === "entrega") {
      tasks.push({
        priority: "alta",
        action: "Coordinar entrega",
        ref_id: s.id,
        title: s.title,
        reason: s.extra || "Entrega pendiente",
        sort_key: 350,
      });
    }

    if (s.kind === "facturacion") {
      tasks.push({
        priority: "alta",
        action: "Facturar",
        ref_id: s.id,
        title: s.title,
        reason: "Pendiente de facturación",
        sort_key: 360,
      });
    }

    if (s.kind === "oportunidad" && (s.mm_score ?? 0) >= 55) {
      tasks.push({
        priority: "oportunidades",
        action: "Analizar / cotizar oportunidad",
        ref_id: s.id,
        title: s.title,
        reason: `M&M SCORE ${s.mm_score}`,
        sort_key: 1000 - (s.mm_score ?? 0),
      });
    }

    if (s.kind === "capital" && (s.amount ?? 0) < 0) {
      tasks.push({
        priority: "urgente",
        action: "Revisar capital operativo negativo",
        ref_id: s.id,
        title: s.title,
        reason: "CAPITAL_OPERATIVO_REAL < 0",
        sort_key: 0,
      });
    }
  }

  const order: Record<TaskPriority, number> = {
    urgente: 0,
    alta: 1,
    oportunidades: 2,
  };
  tasks.sort((a, b) => order[a.priority] - order[b.priority] || a.sort_key - b.sort_key);
  return tasks;
}
