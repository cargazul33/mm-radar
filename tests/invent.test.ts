import { describe, it, expect } from "vitest";
import { inventFlags, assertNoInventPolicy, sanitizeOpportunityDisplay } from "../src/engines/invent.js";
import { computeProfit } from "../src/engines/profit.js";

describe("no invent flags", () => {
  it("policy forbids invent", () => {
    const p = assertNoInventPolicy();
    expect(p.invent_allowed).toBe(false);
  });

  it("flags unverified cost/stock/supplier", () => {
    const flags = inventFlags({
      unit_cost: 10,
      stock: 3,
      supplier_name: "ACME",
      cost_verified: false,
      stock_verified: false,
      supplier_verified: false,
    });
    expect(flags).toContain("COSTO_SIN_VERIFICAR");
    expect(flags).toContain("STOCK_SIN_VERIFICAR");
    expect(flags).toContain("STOCK_NO_VERIFICADO");
    expect(flags).toContain("PROVEEDOR_SIN_VERIFICAR");
  });

  it("profit engine returns NO VERIFICADO without verified costs", () => {
    const p = computeProfit([{ qty: 1, unit_cost: 100, cost_verified: false }]);
    expect(p.cost_total).toBeNull();
    expect(p.precio_objetivo).toBeNull();
    expect(p.sell_price).toBeNull();
    expect(p.verification).toBe("NO VERIFICADO");
  });

  it("profit uses markup 1.9 only when costs verified", () => {
    const p = computeProfit([{ qty: 2, unit_cost: 100, cost_verified: true }], 1.9);
    expect(p.cost_total).toBe(200);
    expect(p.precio_objetivo).toBe(380);
    expect(p.sell_price).toBe(380);
    expect(p.utilidad_estimada).toBe(180);
    expect(p.gross).toBe(180);
    expect(p.verification).toBe("VERIFICADO");
  });

  it("sanitize labels missing commercial fields", () => {
    const s = sanitizeOpportunityDisplay({ title: "x", cost_total: null });
    expect(s.cost_total_label).toBe("NO VERIFICADO");
  });
});
