import { describe, it, expect } from "vitest";
import { isHardSkipped, hardSkipReason } from "../src/engines/hardskip.js";

describe("hard-skip 16514", () => {
  it("skips 16514 and CODINEU-16514", () => {
    expect(isHardSkipped("16514")).toBe(true);
    expect(isHardSkipped("CODINEU-16514")).toBe(true);
    expect(isHardSkipped(16514)).toBe(true);
    expect(isHardSkipped("16813")).toBe(false);
  });
  it("reason mentions policy", () => {
    expect(hardSkipReason("16514")).toMatch(/HARD_SKIP/);
  });
});
