import { META_VENTAS_MENSUAL, META_GANANCIA_MENSUAL } from "../constants.js";

export type ProjectionScenario = "conservador" | "base" | "agresivo";

export type ProjectionInput = {
  ventas_reales_mes: number;
  ganancia_real_mes: number;
  pipeline_sell_verified: number; // suma precios verificados en pipeline activo
  pipeline_net_estimated: number;
};

export type ProjectionRow = {
  scenario: ProjectionScenario;
  label: "ESTIMACIÓN";
  ventas: number;
  ganancia: number;
  vs_meta_ventas: number;
  vs_meta_ganancia: number;
  note: string;
};

/**
 * Simulador de proyecciones. Siempre etiquetado ESTIMACIÓN.
 * Si no hay datos reales, todo en 0 — no inventa.
 */
export function projectScenarios(input: ProjectionInput): ProjectionRow[] {
  const v = Number(input.ventas_reales_mes) || 0;
  const g = Number(input.ganancia_real_mes) || 0;
  const ps = Number(input.pipeline_sell_verified) || 0;
  const pn = Number(input.pipeline_net_estimated) || 0;

  const mk = (scenario: ProjectionScenario, vf: number, gf: number, note: string): ProjectionRow => {
    const ventas = v + ps * vf;
    const ganancia = g + pn * gf;
    return {
      scenario,
      label: "ESTIMACIÓN",
      ventas,
      ganancia,
      vs_meta_ventas: META_VENTAS_MENSUAL > 0 ? ventas / META_VENTAS_MENSUAL : 0,
      vs_meta_ganancia: META_GANANCIA_MENSUAL > 0 ? ganancia / META_GANANCIA_MENSUAL : 0,
      note,
    };
  };

  if (v === 0 && g === 0 && ps === 0 && pn === 0) {
    return [
      mk("conservador", 0, 0, "Sin datos reales ni pipeline verificado → 0"),
      mk("base", 0, 0, "Sin datos reales ni pipeline verificado → 0"),
      mk("agresivo", 0, 0, "Sin datos reales ni pipeline verificado → 0"),
    ];
  }

  return [
    mk("conservador", 0.3, 0.25, "30% del pipeline verificado se concreta"),
    mk("base", 0.55, 0.45, "55% del pipeline verificado se concreta"),
    mk("agresivo", 0.8, 0.7, "80% del pipeline verificado se concreta — techo, no promesa"),
  ];
}
