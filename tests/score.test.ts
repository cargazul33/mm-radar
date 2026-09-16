import { describe, it, expect } from "vitest";
import { computeMmScore, scoreBand, rubroPriority } from "../src/engines/score.js";

describe("score M&M", () => {
  it("components sum bands ATACAR/COTIZAR/REVISAR/DESCARTAR", () => {
    expect(scoreBand(80)).toBe("ATACAR");
    expect(scoreBand(60)).toBe("COTIZAR");
    expect(scoreBand(40)).toBe("REVISAR");
    expect(scoreBand(10)).toBe("DESCARTAR");
  });

  it("missing data → zeros + NO VERIFICADO why", () => {
    const s = computeMmScore({});
    expect(s.total).toBe(0);
    expect(s.encaje).toBe(0);
    expect(s.margen).toBe(0);
    expect(s.band).toBe("DESCARTAR");
    expect(s.why.some((w) => w.includes("NO VERIFICADO") || w.includes("PRECIO_NO_VERIFICADO"))).toBe(true);
  });

  it("full strong IT score → ATACAR or COTIZAR", () => {
    const s = computeMmScore({
      fit_hint: 100,
      rubros: "Hardware | Electricidad",
      margin_ratio: 0.47,
      match_type: "EXACTO",
      stock_verified: true,
      capital_requerido: 1_000_000,
      capital_libre: 3_000_000,
      cobro_firmes: true,
      win_probability: 0.8,
      historial_score: 8,
    });
    expect(s.encaje).toBe(20);
    expect(s.abastecimiento).toBe(15);
    expect(s.cobro).toBe(15);
    expect(s.total).toBeGreaterThanOrEqual(75);
    expect(s.band).toBe("ATACAR");
  });

  it("deprioritizes health/police", () => {
    const r = rubroPriority("Insumos de salud hospitalaria");
    expect(r.avoided).toBe(true);
    const s = computeMmScore({ fit_hint: 100, rubros: "policia" });
    expect(s.encaje).toBe(0);
  });
});
