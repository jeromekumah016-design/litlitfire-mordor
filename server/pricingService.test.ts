import { describe, it, expect } from "vitest";
import {
  calculatePrice,
  calculateLiteDisplayPrice,
  getPricingBreakdown,
  validatePricingConfig,
  DEFAULT_PRICING_CONFIG,
  type PricingConfig,
} from "./pricingService";

describe("pricingService", () => {
  describe("calculateLiteDisplayPrice", () => {
    it("prices by chapter image units, not raw page count", () => {
      const lite = calculateLiteDisplayPrice(3);
      const byPages = calculatePrice(100);
      expect(lite).toBe(calculatePrice(3));
      expect(lite).toBeLessThan(byPages);
    });

    it("uses at least one unit", () => {
      expect(calculateLiteDisplayPrice(0)).toBe(calculatePrice(1));
    });
  });

  describe("calculatePrice", () => {
    it("should calculate price for single page", () => {
      const price = calculatePrice(1);
      expect(price).toBeGreaterThan(0);
      expect(price).toBeGreaterThanOrEqual(DEFAULT_PRICING_CONFIG.minPrice);
    });

    it("should apply minimum price", () => {
      const price = calculatePrice(1);
      expect(price).toBe(DEFAULT_PRICING_CONFIG.minPrice);
    });

    it("should calculate tiered pricing correctly", () => {
      const price50 = calculatePrice(50);
      const price100 = calculatePrice(100);

      // Higher page count should have lower or equal per-page price
      expect(price100 / 100).toBeLessThanOrEqual(price50 / 50);
    });

    it("should apply maximum price cap", () => {
      const price = calculatePrice(10000);
      expect(price).toBeLessThanOrEqual(DEFAULT_PRICING_CONFIG.maxPrice);
    });

    it("should throw for zero pages", () => {
      expect(() => calculatePrice(0)).toThrow();
    });

    it("should throw for negative pages", () => {
      expect(() => calculatePrice(-5)).toThrow();
    });

    it("should round to 2 decimal places", () => {
      const price = calculatePrice(3);
      const decimalPlaces = (price.toString().split(".")[1] || "").length;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });

    it("should handle custom pricing config", () => {
      const customConfig: PricingConfig = {
        basePrice: 1.0,
        minPrice: 5.0,
        maxPrice: 100.0,
      };

      const price = calculatePrice(1, customConfig);
      expect(price).toBe(5.0); // Should apply minimum
    });

    it("should apply marginal (bracket) tiered pricing from config", () => {
      const tieredConfig: PricingConfig = {
        basePrice: 1.0,
        minPrice: 1.0,
        maxPrice: 1000.0,
        tieredPricing: [
          { threshold: 1, pricePerPage: 1.0 },
          { threshold: 10, pricePerPage: 0.8 },
          { threshold: 50, pricePerPage: 0.5 },
        ],
      };

      const price1 = calculatePrice(5, tieredConfig);
      const price10 = calculatePrice(15, tieredConfig);
      const price50 = calculatePrice(100, tieredConfig);

      // 5 pages, all within the first bracket (1-9): 5 * 1.0
      expect(price1).toBe(5.0);
      // 15 pages: 9 @ 1.0 (bracket 1-9) + 6 @ 0.8 (bracket 10-49) = 9 + 4.8
      expect(price10).toBe(13.8);
      // 100 pages: 9 @ 1.0 + 40 @ 0.8 (bracket 10-49) + 51 @ 0.5 (bracket 50+) = 9 + 32 + 25.5
      expect(price50).toBe(66.5);
    });

    it("regression (H4): price must never decrease when page count increases across a tier boundary", () => {
      // Previously, whole-count-times-single-tier-rate pricing meant 50 pages
      // ($20.00 flat @ 0.4/pg) cost LESS than 49 pages ($24.50 flat @ 0.5/pg).
      // Marginal/bracket pricing must be monotonically non-decreasing for any
      // config whose per-page rate decreases at higher thresholds (the only
      // shape this app uses).
      for (let n = 1; n < 120; n++) {
        expect(calculatePrice(n + 1)).toBeGreaterThanOrEqual(calculatePrice(n));
      }
    });

    it("prices exactly at and around the default 50/100 tier boundaries without a cliff", () => {
      expect(calculatePrice(49)).toBe(24.5); // 49 * 0.5, all in bracket 1-49
      expect(calculatePrice(50)).toBe(24.9); // 24.5 + 1 * 0.4
      expect(calculatePrice(51)).toBe(25.3); // 24.5 + 2 * 0.4
      expect(calculatePrice(99)).toBe(44.5); // 24.5 + 50 * 0.4
      expect(calculatePrice(100)).toBe(44.8); // 44.5 + 1 * 0.3
      expect(calculatePrice(101)).toBe(45.1); // 44.5 + 2 * 0.3
    });
  });

  describe("getPricingBreakdown", () => {
    it("should return pricing breakdown", () => {
      const breakdown = getPricingBreakdown(10);

      expect(breakdown).toHaveProperty("pageCount");
      expect(breakdown).toHaveProperty("pricePerPage");
      expect(breakdown).toHaveProperty("subtotal");
      expect(breakdown).toHaveProperty("total");
      expect(breakdown).toHaveProperty("tier");
    });

    it("should have correct page count in breakdown", () => {
      const breakdown = getPricingBreakdown(25);
      expect(breakdown.pageCount).toBe(25);
    });

    it("should calculate subtotal correctly", () => {
      const breakdown = getPricingBreakdown(10);
      const expectedSubtotal = 10 * breakdown.pricePerPage;
      expect(breakdown.subtotal).toBe(expectedSubtotal);
    });

    it("should apply constraints to total", () => {
      const breakdown = getPricingBreakdown(1);
      expect(breakdown.total).toBeGreaterThanOrEqual(DEFAULT_PRICING_CONFIG.minPrice);

      const largeBreakdown = getPricingBreakdown(10000);
      expect(largeBreakdown.total).toBeLessThanOrEqual(DEFAULT_PRICING_CONFIG.maxPrice);
    });

    it("should identify correct tier", () => {
      const breakdown1 = getPricingBreakdown(5);
      const breakdown50 = getPricingBreakdown(75);
      const breakdown100 = getPricingBreakdown(150);

      expect(breakdown1.tier).toBeDefined();
      expect(breakdown50.tier).toBeDefined();
      expect(breakdown100.tier).toBeDefined();
    });
  });

  describe("validatePricingConfig", () => {
    it("should validate correct config", () => {
      const result = validatePricingConfig(DEFAULT_PRICING_CONFIG);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject zero base price", () => {
      const config: PricingConfig = {
        basePrice: 0,
        minPrice: 1.0,
        maxPrice: 100.0,
      };

      const result = validatePricingConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject negative minimum price", () => {
      const config: PricingConfig = {
        basePrice: 1.0,
        minPrice: -1.0,
        maxPrice: 100.0,
      };

      const result = validatePricingConfig(config);
      expect(result.valid).toBe(false);
    });

    it("should reject min > max", () => {
      const config: PricingConfig = {
        basePrice: 1.0,
        minPrice: 100.0,
        maxPrice: 50.0,
      };

      const result = validatePricingConfig(config);
      expect(result.valid).toBe(false);
    });

    it("should validate tiered pricing", () => {
      const config: PricingConfig = {
        basePrice: 1.0,
        minPrice: 1.0,
        maxPrice: 100.0,
        tieredPricing: [
          { threshold: 1, pricePerPage: 1.0 },
          { threshold: 10, pricePerPage: 0.8 },
        ],
      };

      const result = validatePricingConfig(config);
      expect(result.valid).toBe(true);
    });

    it("should reject invalid tier threshold", () => {
      const config: PricingConfig = {
        basePrice: 1.0,
        minPrice: 1.0,
        maxPrice: 100.0,
        tieredPricing: [{ threshold: 0, pricePerPage: 1.0 }],
      };

      const result = validatePricingConfig(config);
      expect(result.valid).toBe(false);
    });

    it("should reject duplicate thresholds", () => {
      const config: PricingConfig = {
        basePrice: 1.0,
        minPrice: 1.0,
        maxPrice: 100.0,
        tieredPricing: [
          { threshold: 10, pricePerPage: 1.0 },
          { threshold: 10, pricePerPage: 0.8 },
        ],
      };

      const result = validatePricingConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  describe("pricing edge cases", () => {
    it("should handle very large page counts", () => {
      const price = calculatePrice(100000);
      expect(price).toBeLessThanOrEqual(DEFAULT_PRICING_CONFIG.maxPrice);
      expect(price).toBeGreaterThan(0);
    });

    it("should maintain price consistency", () => {
      const price1 = calculatePrice(100);
      const price2 = calculatePrice(100);
      expect(price1).toBe(price2);
    });

    it("should scale linearly within tier", () => {
      const price10 = calculatePrice(10);
      const price20 = calculatePrice(20);

      // Both should be in the same tier (1-50), so should scale proportionally
      const ratio = price20 / price10;
      expect(ratio).toBeCloseTo(2, 1);
    });
  });
});
