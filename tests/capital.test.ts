import { describe, it, expect } from "vitest";
import { computeCapitalOperativoReal } from "../src/engines/capital.js";

describe("caja formula", () => {
  it("CAPITAL OPERATIVO REAL = caja + CxC - deudas - impuestos - compromisos", () => {
    const r = computeCapitalOperativoReal({
      caja: 100,
      cxc_firmes: 50,
      deudas: 20,
      impuestos: 10,
      compromisos: 15,
    });
    expect(r.capital_operativo_real).toBe(105);
    expect(r.quotes_excluded).toBe(true);
    expect(r.libre).toBe(105);
  });

  it("negative capital alerts", () => {
    const r = computeCapitalOperativoReal({
      caja: 10,
      cxc_firmes: 0,
      deudas: 50,
      impuestos: 0,
      compromisos: 0,
    });
    expect(r.capital_operativo_real).toBe(-40);
    expect(r.alerts.some((a) => a.includes("CAPITAL_NEGATIVO"))).toBe(true);
  });
});
