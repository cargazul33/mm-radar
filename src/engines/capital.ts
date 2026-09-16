/**
 * Caja / capital operativo.
 * CAPITAL OPERATIVO REAL = caja + CxC firmes − deudas − impuestos − compromisos
 * Nunca contar cotizaciones / quotes como caja.
 */
export type CapitalInput = {
  caja: number;
  cxc_firmes: number;
  deudas: number;
  impuestos: number;
  /** compromisos de compra (alias: compromisos_compra) */
  compromisos?: number;
  compromisos_compra?: number;
};

export type CapitalResult = {
  capital_operativo_real: number;
  caja: number;
  por_cobrar: number;
  comprometido: number;
  libre: number;
  libre_para_ops: number;
  formula: string;
  formula_es: string;
  components: {
    caja: number;
    cxc_firmes: number;
    deudas: number;
    impuestos: number;
    compromisos: number;
    compromisos_compra: number;
  };
  alerts: string[];
  quotes_excluded: true;
};

export function computeCapitalOperativoReal(input: CapitalInput): CapitalResult {
  const caja = Number(input.caja) || 0;
  const cxc_firmes = Number(input.cxc_firmes) || 0;
  const deudas = Number(input.deudas) || 0;
  const impuestos = Number(input.impuestos) || 0;
  const compromisos = Number(input.compromisos ?? input.compromisos_compra) || 0;

  const capital_operativo_real = caja + cxc_firmes - deudas - impuestos - compromisos;

  const alerts: string[] = [];
  if (capital_operativo_real < 0) {
    alerts.push("CAPITAL_NEGATIVO: no hay margen operativo libre");
  }
  if (caja < compromisos && compromisos > 0) {
    alerts.push("CAJA_INSUFICIENTE_VS_COMPROMISOS");
  }

  const libre = Math.max(0, capital_operativo_real);
  return {
    capital_operativo_real,
    caja,
    por_cobrar: cxc_firmes,
    comprometido: compromisos + deudas + impuestos,
    libre,
    libre_para_ops: libre,
    formula: "caja + CxC_firmes - deudas - impuestos - compromisos_compra",
    formula_es:
      "CAPITAL OPERATIVO REAL = caja + CxC firmes − deudas − impuestos − compromisos (nunca contar cotizaciones como caja)",
    components: { caja, cxc_firmes, deudas, impuestos, compromisos, compromisos_compra: compromisos },
    alerts,
    quotes_excluded: true,
  };
}
