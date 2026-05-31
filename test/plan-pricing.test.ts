/** @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  applyRetailRateToNetworkMicros,
  markupPercentToRetailRateUsd,
} from "../src/plan-pricing.js";

describe("plan-pricing", () => {
  it("1000% markup is 11x network micros", () => {
    expect(markupPercentToRetailRateUsd(1000)).toBe("0.000011");
    expect(applyRetailRateToNetworkMicros(148854n, "0.000011")).toBe(1637394n);
  });
});
