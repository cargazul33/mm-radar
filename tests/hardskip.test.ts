import { describe, it, expect } from "vitest";
import { isHardSkipped, hardSkipReason } from "../src/engines/hardskip.js";

describe("hard-skip CODINEU 16514", () => {
  it("skips 16514 in all common forms", () => {
    expect(isHardSkipped("16514")).toBe(true);
    expect(isHardSkipped(16514)).toBe(true);
    expect(isHardSkipped("CODINEU-16514")).toBe(true);
  });

  it("does not skip other ids", () => {
    expect(isHardSkipped("16813")).toBe(false);
    expect(isHardSkipped("16515")).toBe(false);
    expect(isHardSkipped("")).toBe(false);
    expect(isHardSkipped(null)).toBe(false);
  });

  it("exposes reason", () => {
    expect(hardSkipReason("16514")).toMatch(/16514/);
  });
});
