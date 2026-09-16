import { describe, it, expect } from "vitest";
import {
  inventFlags,
  assertNoInventPolicy,
  guardNoFakeTenders,
  sanitizeOpportunityDisplay,
} from "../src/engines/invent.js";
import { LABEL_STOCK_NO_VERIFICADO, LABEL_PRECIO_NO_VERIFICADO, LABEL_COBRO_ESTIMADO } from "../src/constants.js";

describe("no-fake guards", () => {
  it("policy forbids invent", () => {
    expect(assertNoInventPolicy().invent_allowed).toBe(false);
  });

  it("flags unverified price/stock/cobro", () => {
    const f = inventFlags({
      unit_cost: 100,
      stock: 5,
      cobro_amount: 1000,
    });
    expect(f).toContain(LABEL_PRECIO_NO_VERIFICADO);
    expect(f).toContain(LABEL_STOCK_NO_VERIFICADO);
    expect(f).toContain(LABEL_COBRO_ESTIMADO);
  });

  it("guard rejects rows without source_url", () => {
    expect(guardNoFakeTenders([{ title: "x" }]).ok).toBe(false);
    expect(guardNoFakeTenders([{ source_url: "https://example.com" }]).ok).toBe(true);
  });

  it("sanitize labels missing prices", () => {
    const s = sanitizeOpportunityDisplay({ title: "a" });
    expect(s.cost_total).toBeNull();
    expect(s.cost_total_label).toBe(LABEL_PRECIO_NO_VERIFICADO);
  });
});
