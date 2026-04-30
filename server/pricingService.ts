/**
 * Pricing configuration for PDF processing
 */
export interface PricingConfig {
  basePrice: number; // Base price per page
  minPrice: number; // Minimum price for any book
  maxPrice: number; // Maximum price cap
  tieredPricing?: {
    threshold: number; // Page count threshold
    pricePerPage: number; // Price per page for this tier
  }[];
}

/**
 * Default pricing configuration
 * Adjust these values based on your business model
 */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  basePrice: 0.5, // $0.50 per page
  minPrice: 2.0, // Minimum $2.00
  maxPrice: 500.0, // Maximum $500.00
  tieredPricing: [
    { threshold: 1, pricePerPage: 0.5 }, // 1-50 pages: $0.50 each
    { threshold: 50, pricePerPage: 0.4 }, // 51-100 pages: $0.40 each
    { threshold: 100, pricePerPage: 0.3 }, // 101+ pages: $0.30 each
  ],
};

/**
 * Calculate the price for processing a PDF based on page count
 */
export function calculatePrice(pageCount: number, config: PricingConfig = DEFAULT_PRICING_CONFIG): number {
  if (pageCount <= 0) {
    throw new Error("Page count must be greater than 0");
  }

  let price = 0;

  // Apply tiered pricing if configured
  if (config.tieredPricing && config.tieredPricing.length > 0) {
    // Sort by threshold descending to find the applicable tier
    const sortedTiers = [...config.tieredPricing].sort((a, b) => b.threshold - a.threshold);

    for (const tier of sortedTiers) {
      if (pageCount >= tier.threshold) {
        price = pageCount * tier.pricePerPage;
        break;
      }
    }

    // Fallback to base price if no tier matched
    if (price === 0) {
      price = pageCount * config.basePrice;
    }
  } else {
    // Simple linear pricing
    price = pageCount * config.basePrice;
  }

  // Apply minimum and maximum constraints
  price = Math.max(price, config.minPrice);
  price = Math.min(price, config.maxPrice);

  // Round to 2 decimal places
  return Math.round(price * 100) / 100;
}

/**
 * Get pricing breakdown for display
 */
export function getPricingBreakdown(
  pageCount: number,
  config: PricingConfig = DEFAULT_PRICING_CONFIG
): {
  pageCount: number;
  pricePerPage: number;
  subtotal: number;
  total: number;
  tier?: string;
} {
  const total = calculatePrice(pageCount, config);
  let pricePerPage = config.basePrice;
  let tier = "standard";

  // Find applicable tier
  if (config.tieredPricing && config.tieredPricing.length > 0) {
    const sortedTiers = [...config.tieredPricing].sort((a, b) => b.threshold - a.threshold);
    for (const t of sortedTiers) {
      if (pageCount >= t.threshold) {
        pricePerPage = t.pricePerPage;
        tier = `tier_${t.threshold}+`;
        break;
      }
    }
  }

  const subtotal = pageCount * pricePerPage;

  return {
    pageCount,
    pricePerPage,
    subtotal,
    total,
    tier,
  };
}

/**
 * Validate pricing configuration
 */
export function validatePricingConfig(config: PricingConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.basePrice <= 0) {
    errors.push("Base price must be greater than 0");
  }

  if (config.minPrice < 0) {
    errors.push("Minimum price cannot be negative");
  }

  if (config.maxPrice <= 0) {
    errors.push("Maximum price must be greater than 0");
  }

  if (config.minPrice > config.maxPrice) {
    errors.push("Minimum price cannot exceed maximum price");
  }

  if (config.tieredPricing) {
    for (let i = 0; i < config.tieredPricing.length; i++) {
      const tier = config.tieredPricing[i];
      if (tier.threshold <= 0) {
        errors.push(`Tier ${i}: threshold must be greater than 0`);
      }
      if (tier.pricePerPage <= 0) {
        errors.push(`Tier ${i}: price per page must be greater than 0`);
      }
    }

    // Check for duplicate thresholds
    const thresholds = config.tieredPricing.map((t) => t.threshold);
    if (new Set(thresholds).size !== thresholds.length) {
      errors.push("Duplicate thresholds found in tiered pricing");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
