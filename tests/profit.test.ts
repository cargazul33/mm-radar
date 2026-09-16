import { describe, it, expect } from "vitest";
import { computeProfit, rankByCapitalEfficiency } from "../src/engines/profit.js";
import { LABEL_PRECIO_NO_VERIFICADO } from "../src/constants.js";

describe("rentabilidad", () => {
  it("does not invent without verified costs", () => {
    const r = computeProfit([{ qty: 1, unit_cost: 100, cost_verified: false }]);
    expect(r.cost_total).toBeNull();
    expect(r.label).toBe(LABEL_PRECIO_NO_VERIFICADO);
  });

  it("computes markup 1.9 and efficiency", () => {
    const r = computeProfit([{ qty: 2, unit_cost: 100, cost_verified: true }], {
      shipping: 50,
      shipping_verified: true,
      days_locked: 30,
    });
    expect(r.cost_products).toBe(200);
    expect(r.cost_total).toBe(250);
    expect(r.sell_price).toBe(475);
    expect(r.gross).toBe(225);
    expect(r.roi).not.toBeNull();
  });

  it("ranks by capital efficiency not max $", () => {
    const ranked = rankByCapitalEfficiency([
      { id: "big", utilidad_estimada: 1000, capital_requerido: 10000 },
      { id: "eff", utilidad_estimada: 200, capital_requerido: 400 },
    ]);
    expect(ranked[0].id).toBe("eff");
  });
});
