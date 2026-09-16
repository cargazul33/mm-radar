import { describe, it, expect } from "vitest";
import { classifyMatch, stockVerifiedFlag } from "../src/engines/match.js";

describe("exact match rules", () => {
  it("EXACTO only with identical desc + brand/model when required", () => {
    const m = classifyMatch({
      requested: "Notebook Lenovo ThinkPad T14",
      offered: "Notebook Lenovo ThinkPad T14",
      brandRequested: "Lenovo",
      brandOffered: "Lenovo",
      modelRequested: "ThinkPad T14",
      modelOffered: "ThinkPad T14",
    });
    expect(m.match_type).toBe("EXACTO");
  });

  it("EQUIVALENTE when similar but not identical", () => {
    const m = classifyMatch({
      requested: "Notebook Lenovo ThinkPad T14 16GB",
      offered: "Notebook Lenovo ThinkPad T14 Gen 3 16GB RAM",
      brandRequested: "Lenovo",
      brandOffered: "Lenovo",
    });
    expect(m.match_type).toBe("EQUIVALENTE");
  });

  it("NO MATCH when brand differs or empty", () => {
    const m = classifyMatch({
      requested: "Monitor Samsung 24",
      offered: "Monitor LG 24",
      brandRequested: "Samsung",
      brandOffered: "LG",
    });
    expect(m.match_type).toBe("NO MATCH");
  });

  it("never invents stock without verification", () => {
    const s = stockVerifiedFlag(10, false);
    expect(s.stock).toBeNull();
    expect(s.stock_verified).toBe(false);
    expect(s.stock_label).toBe("STOCK_NO_VERIFICADO");
  });

  it("provenExact flag yields EXACTO", () => {
    const m = classifyMatch({
      requested: "a",
      offered: "b",
      provenExact: true,
    });
    expect(m.match_type).toBe("EXACTO");
  });
});
