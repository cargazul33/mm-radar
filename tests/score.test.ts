import { describe, it, expect } from "vitest";
import { computeMmScore, scoreBand } from "../src/engines/score.js";

describe("M&M SCORE bands", () => {
  it("maps ranges correctly (ATACAR/COTIZAR/REVISAR/DESCARTAR)", () => {
    expect(scoreBand(85)).toBe("ATACAR");
    expect(scoreBand(70)).toBe("COTIZAR");
    expect(scoreBand(50)).toBe("REVISAR");
    expect(scoreBand(10)).toBe("DESCARTAR");
    expect(scoreBand(0)).toBe("DESCARTAR");
    expect(scoreBand(100)).toBe("ATACAR");
    expect(scoreBand(75)).toBe("ATACAR");
    expect(scoreBand(55)).toBe("COTIZAR");
    expect(scoreBand(35)).toBe("REVISAR");
    expect(scoreBand(34)).toBe("DESCARTAR");
  });

  it("returns breakdown + why without inventing missing inputs", () => {
    const s = computeMmScore({});
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.encaje).toBe(0);
    expect(s.margen).toBe(0);
    expect(s.abastecimiento).toBe(0);
    expect(s.why.some((w) => w.includes("NO VERIFICADO"))).toBe(true);
    expect(s.band).toBe(scoreBand(s.total));
  });

  it("boosts EXACTO + stock + verified margin + capital + cobro", () => {
    const s = computeMmScore({
      fit_hint: 90,
      rubros: "informatica oficina",
      margin_ratio: 0.47,
      has_verified_cost: true,
      match_type: "EXACTO",
      stock_verified: true,
      capital_requerido: 100,
      capital_libre: 250,
      cobro_firmes: true,
      win_probability: 0.8,
      historial_score: 0.8,
    });
    expect(s.total).toBeGreaterThanOrEqual(75);
    expect(s.band).toBe("ATACAR");
    expect(s.abastecimiento).toBe(15);
    expect(s.cobro).toBe(15);
  });

  it("penalizes avoided category (salud/policía/obra)", () => {
    const s = computeMmScore({
      fit_hint: 90,
      rubros: "salud medico",
      avoided_category: true,
      match_type: "EXACTO",
      stock_verified: true,
    });
    expect(s.encaje).toBe(0);
    expect(s.total).toBeLessThan(75);
  });
});
