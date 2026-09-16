import { describe, it, expect } from "vitest";
import { classifyMatch, stockVerifiedFlag } from "../src/engines/match.js";
import { LABEL_STOCK_NO_VERIFICADO } from "../src/constants.js";

describe("MATCH EXACTO only if proven", () => {
  it("exact with brand/model", () => {
    const m = classifyMatch({
      requested: "router cisco 9163e",
      offered: "router cisco 9163e",
      brandRequested: "Cisco",
      brandOffered: "Cisco",
      modelRequested: "9163E",
      modelOffered: "9163E",
    });
    expect(m.match_type).toBe("EXACTO");
  });

  it("overlap without identity → EQUIVALENTE not EXACTO", () => {
    const m = classifyMatch({
      requested: "router wifi techo",
      offered: "access point wifi techo lite",
      brandRequested: "Wi-Tek",
      brandOffered: "Wi-Tek",
    });
    expect(m.match_type).not.toBe("EXACTO");
  });

  it("stock unverified label", () => {
    expect(stockVerifiedFlag(3, false).stock_label).toBe(LABEL_STOCK_NO_VERIFICADO);
  });
});
