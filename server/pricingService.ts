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
 * Marginal (bracket) tiered subtotal, unclamped, un-rounded.
 *
 * Bug fixed 2026-07-25 (audit finding H4): the previous implementation
 * multiplied the ENTIRE page count by whichever single tier's rate matched,
 * so crossing a tier threshold could make a LARGER book cost LESS (e.g. 50
 * pages @ $0.40/pg flat = $20.00, but 49 pages @ $0.50/pg flat = $24.50 --
 * one more page, $4.50 cheaper). Standard marginal/bracket pricing instead
 * charges each page at the rate for ITS OWN bracket only (like progressive
 * tax brackets), which is monotonically non-decreasing in page count by
 * construction as long as rates decrease with threshold (the only shape
 * this pricing model uses).
 */
function computeTieredSubtotal(pageCount: number, config: PricingConfig): number {
  if (!config.tieredPricing || config.tieredPricing.length === 0) {
    return pageCount * config.basePrice;
  }

  // Sort by threshold ascending so we can walk brackets low -> high.
  const sortedTiers = [...config.tieredPricing].sort((a, b) => a.threshold - b.threshold);

  let subtotal = 0;
  let matchedAnyTier = false;
  for (let i = 0; i < sortedTiers.length; i++) {
    const tier = sortedTiers[i];
    if (pageCount < tier.threshold) break;
    matchedAnyTier = true;

    const nextThreshold = sortedTiers[i + 1]?.threshold;
    const bracketEnd = nextThreshold !== undefined ? Math.min(pageCount, nextThreshold - 1) : pageCount;
    const pagesInBracket = bracketEnd - tier.threshold + 1;
    if (pagesInBracket > 0) {
      subtotal += pagesInBracket * tier.pricePerPage;
    }
  }

  // Fallback to base price if page count is below every tier's threshold
  // (e.g. a config whose lowest threshold is > 1).
  if (!matchedAnyTier) {
    subtotal = pageCount * config.basePrice;
  }

  return subtotal;
}

/**
 * Calculate the price for processing a PDF based on page count.
 * Uses marginal/bracket tiered pricing -- see computeTieredSubtotal.
 */
export function calculatePrice(pageCount: number, config: PricingConfig = DEFAULT_PRICING_CONFIG): number {
  if (pageCount <= 0) {
    throw new Error("Page count must be greater than 0");
  }

  let price = computeTieredSubtotal(pageCount, config);

  // Apply minimum and maximum constraints
  price = Math.max(price, config.minPrice);
  price = Math.min(price, config.maxPrice);

  // Round to 2 decimal places
  return Math.round(price * 100) / 100;
}

/**
 * Lite package display price: charge for illustration units (chapters),
 * not raw PDF page count. Reuses the same tier table with unit count as input.
 * Display / framing only until billing exists.
 */
export function calculateLiteDisplayPrice(
  mainChapterCount: number,
  config: PricingConfig = DEFAULT_PRICING_CONFIG
): number {
  const units = Math.max(1, Math.floor(mainChapterCount) || 1);
  return calculatePrice(units, config);
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

  // Find the marginal tier this page count has reached (informational --
  // "you are now paying $X/page for pages beyond N"). The actual subtotal
  // is the full bracket-by-bracket sum below, not pageCount * pricePerPage,
  // since earlier pages were charged at earlier (higher) tier rates.
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

  // Pre-cap marginal subtotal (total below is this, clamped to min/max + rounded).
  const subtotal = Math.round(computeTieredSubtotal(pageCount, config) * 100) / 100;

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
