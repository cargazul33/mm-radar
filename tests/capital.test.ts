import { describe, it, expect } from "vitest";
import { computeCapitalOperativoReal } from "../src/engines/capital.js";

describe("CAPITAL_OPERATIVO_REAL", () => {
  it("applies formula caja + CxC - deudas - impuestos - compromisos", () => {
    const r = computeCapitalOperativoReal({
      caja: 1000,
      cxc_firmes: 500,
      deudas: 200,
      impuestos: 100,
      compromisos_compra: 150,
    });
    expect(r.capital_operativo_real).toBe(1050);
    expect(r.formula).toContain("caja");
    expect(r.libre_para_ops).toBe(1050);
    expect(r.libre).toBe(1050);
    expect(r.quotes_excluded).toBe(true);
  });

  it("flags negative capital", () => {
    const r = computeCapitalOperativoReal({
      caja: 100,
      cxc_firmes: 0,
      deudas: 80,
      impuestos: 50,
      compromisos: 40,
    });
    expect(r.capital_operativo_real).toBe(-70);
    expect(r.alerts).toContain("CAPITAL_NEGATIVO: no hay margen operativo libre");
    expect(r.libre_para_ops).toBe(0);
  });
});
