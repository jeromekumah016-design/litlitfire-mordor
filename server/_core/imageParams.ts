/**
 * Image Generation Parameters
 * ===========================
 *
 * A small, pure layer that defines the RENDER-SIDE controls for image
 * generation: aspect ratio, quality and stylisation. These are knobs the user
 * (or a book-level setting) turns to control how an illustration is rendered —
 * its shape and fidelity — independent of WHAT is drawn.
 *
 * Decoupling invariant -- UPHELD
 * ------------------------------
 * These parameters live entirely on the image-rendering side. They are NOT
 * derived from OCR text and they are NOT part of the story bible. OCR
 * transcription -> story bible -> prompt remains the content path; this module
 * only governs how the resolved prompt is rasterised. Nothing here reads page
 * text or couples transcription to rendering.
 *
 * Everything is pure (no network, no I/O) so the whole layer is unit-testable
 * and the offline placeholder can mirror the same parameters with zero spend.
 */

/** Aspect ratio of the generated illustration. */
export type AspectRatio = "square" | "portrait" | "landscape";

/** Render fidelity. Maps to the model's quality tier. */
export type ImageQuality = "standard" | "hd";

/** Stylisation bias. Maps to the model's style flag. */
export type ImageStyle = "vivid" | "natural";

export interface ImageGenParams {
  aspectRatio: AspectRatio;
  quality: ImageQuality;
  style: ImageStyle;
}

/** DALL-E 3 only accepts these three pixel sizes. */
export type DalleSize = "1024x1024" | "1024x1792" | "1792x1024";

export const ASPECT_RATIOS: readonly AspectRatio[] = ["square", "portrait", "landscape"] as const;
export const IMAGE_QUALITIES: readonly ImageQuality[] = ["standard", "hd"] as const;
export const IMAGE_STYLES: readonly ImageStyle[] = ["vivid", "natural"] as const;

/**
 * Sensible defaults. Square + standard + vivid matches the legacy hardcoded
 * behaviour (1024x1024), so existing books render identically unless a caller
 * opts into different parameters.
 */
export const DEFAULT_IMAGE_PARAMS: ImageGenParams = {
  aspectRatio: "square",
  quality: "standard",
  style: "vivid",
};

/** Map an aspect ratio to the corresponding DALL-E 3 pixel size. */
export function resolveDalleSize(aspectRatio: AspectRatio): DalleSize {
  switch (aspectRatio) {
    case "portrait":
      return "1024x1792";
    case "landscape":
      return "1792x1024";
    case "square":
    default:
      return "1024x1024";
  }
}

/** Map an aspect ratio to placeholder canvas dimensions (offline mirror). */
export function resolvePlaceholderDimensions(aspectRatio: AspectRatio): {
  width: number;
  height: number;
} {
  const [w, h] = resolveDalleSize(aspectRatio).split("x").map((n) => parseInt(n, 10));
  return { width: w, height: h };
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Coerce arbitrary input (user payload, persisted JSON, partial object) into a
 * complete, valid ImageGenParams. Unknown or malformed fields fall back to the
 * defaults rather than throwing, so a bad value can never crash the pipeline or
 * reach the model. Pure and exported for direct unit testing.
 *
 * Also accepts a couple of common aliases so a permissive UI/API surface still
 * normalises cleanly: "1:1"/"1024x1024" -> square, "9:16"/portrait sizes ->
 * portrait, "16:9"/landscape sizes -> landscape; "high" -> hd.
 */
export function normalizeImageParams(raw: unknown): ImageGenParams {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_IMAGE_PARAMS };
  const r = raw as Record<string, unknown>;

  const aspectRatio = oneOf(
    normalizeAspectAlias(r.aspectRatio),
    ASPECT_RATIOS,
    DEFAULT_IMAGE_PARAMS.aspectRatio
  );
  const quality = oneOf(
    normalizeQualityAlias(r.quality),
    IMAGE_QUALITIES,
    DEFAULT_IMAGE_PARAMS.quality
  );
  const style = oneOf(r.style, IMAGE_STYLES, DEFAULT_IMAGE_PARAMS.style);

  return { aspectRatio, quality, style };
}

function normalizeAspectAlias(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const v = value.trim().toLowerCase();
  switch (v) {
    case "1:1":
    case "1024x1024":
      return "square";
    case "9:16":
    case "2:3":
    case "1024x1792":
      return "portrait";
    case "16:9":
    case "3:2":
    case "1792x1024":
      return "landscape";
    default:
      return v;
  }
}

function normalizeQualityAlias(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const v = value.trim().toLowerCase();
  if (v === "high") return "hd";
  if (v === "normal") return "standard";
  return v;
}
