import { describe, expect, it } from "vitest";
import { calculateBackoffDelay, type RetryConfig } from "./retryService";

const config: RetryConfig = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

describe("calculateBackoffDelay", () => {
  it("returns the initial delay for the first attempt", () => {
    expect(calculateBackoffDelay(1, config)).toBe(1000);
  });

  it("doubles each attempt (exponential backoff)", () => {
    expect(calculateBackoffDelay(2, config)).toBe(2000);
    expect(calculateBackoffDelay(3, config)).toBe(4000);
    expect(calculateBackoffDelay(4, config)).toBe(8000);
  });

  it("caps the delay at maxDelayMs", () => {
    // 1000 * 2^9 = 512000, well above the 60s cap.
    expect(calculateBackoffDelay(10, config)).toBe(60000);
  });

  it("honors a custom multiplier", () => {
    const tripling: RetryConfig = { ...config, backoffMultiplier: 3 };
    expect(calculateBackoffDelay(3, tripling)).toBe(9000); // 1000 * 3^2
  });

  it("uses the default config when none is provided", () => {
    // Defaults: initial 1000, multiplier 2 → attempt 3 = 4000.
    expect(calculateBackoffDelay(3)).toBe(4000);
  });
});
