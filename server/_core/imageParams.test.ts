import { describe, it, expect } from "vitest";
import {
  DEFAULT_IMAGE_PARAMS,
  normalizeImageParams,
  resolveDalleSize,
  resolvePlaceholderDimensions,
  type ImageGenParams,
} from "./imageParams";

describe("imageParams", () => {
  describe("resolveDalleSize", () => {
    it("maps each aspect ratio to a valid DALL-E 3 size", () => {
      expect(resolveDalleSize("square")).toBe("1024x1024");
      expect(resolveDalleSize("portrait")).toBe("1024x1792");
      expect(resolveDalleSize("landscape")).toBe("1792x1024");
    });

    it("only ever returns sizes DALL-E 3 accepts", () => {
      const valid = new Set(["1024x1024", "1024x1792", "1792x1024"]);
      for (const ar of ["square", "portrait", "landscape"] as const) {
        expect(valid.has(resolveDalleSize(ar))).toBe(true);
      }
    });
  });

  describe("resolvePlaceholderDimensions", () => {
    it("derives width/height from the DALL-E size", () => {
      expect(resolvePlaceholderDimensions("square")).toEqual({ width: 1024, height: 1024 });
      expect(resolvePlaceholderDimensions("portrait")).toEqual({ width: 1024, height: 1792 });
      expect(resolvePlaceholderDimensions("landscape")).toEqual({ width: 1792, height: 1024 });
    });

    it("portrait is taller than wide, landscape is wider than tall", () => {
      const p = resolvePlaceholderDimensions("portrait");
      const l = resolvePlaceholderDimensions("landscape");
      expect(p.height).toBeGreaterThan(p.width);
      expect(l.width).toBeGreaterThan(l.height);
    });
  });

  describe("normalizeImageParams", () => {
    it("returns defaults for null/undefined/non-object input", () => {
      expect(normalizeImageParams(undefined)).toEqual(DEFAULT_IMAGE_PARAMS);
      expect(normalizeImageParams(null)).toEqual(DEFAULT_IMAGE_PARAMS);
      expect(normalizeImageParams("nope")).toEqual(DEFAULT_IMAGE_PARAMS);
      expect(normalizeImageParams(42)).toEqual(DEFAULT_IMAGE_PARAMS);
    });

    it("returns a fresh object, not the shared DEFAULT reference", () => {
      const a = normalizeImageParams(undefined);
      expect(a).not.toBe(DEFAULT_IMAGE_PARAMS);
      a.aspectRatio = "portrait";
      expect(DEFAULT_IMAGE_PARAMS.aspectRatio).toBe("square");
    });

    it("passes through valid canonical values", () => {
      const input: ImageGenParams = { aspectRatio: "landscape", quality: "hd", style: "natural" };
      expect(normalizeImageParams(input)).toEqual(input);
    });

    it("fills missing fields with defaults", () => {
      expect(normalizeImageParams({ aspectRatio: "portrait" })).toEqual({
        aspectRatio: "portrait",
        quality: "standard",
        style: "vivid",
      });
    });

    it("falls back per-field on invalid values (never throws)", () => {
      expect(normalizeImageParams({ aspectRatio: "circle", quality: "ultra", style: "weird" })).toEqual(
        DEFAULT_IMAGE_PARAMS
      );
    });

    it("accepts aspect-ratio aliases", () => {
      expect(normalizeImageParams({ aspectRatio: "1:1" }).aspectRatio).toBe("square");
      expect(normalizeImageParams({ aspectRatio: "9:16" }).aspectRatio).toBe("portrait");
      expect(normalizeImageParams({ aspectRatio: "16:9" }).aspectRatio).toBe("landscape");
      expect(normalizeImageParams({ aspectRatio: "1792x1024" }).aspectRatio).toBe("landscape");
      expect(normalizeImageParams({ aspectRatio: "  PORTRAIT  " }).aspectRatio).toBe("portrait");
    });

    it("accepts quality aliases", () => {
      expect(normalizeImageParams({ quality: "high" }).quality).toBe("hd");
      expect(normalizeImageParams({ quality: "normal" }).quality).toBe("standard");
      expect(normalizeImageParams({ quality: "HD" }).quality).toBe("hd"); // case-insensitive
    });

    it("ignores extra unknown keys", () => {
      const out = normalizeImageParams({ aspectRatio: "portrait", seed: 7, n: 4 } as Record<string, unknown>);
      expect(out).toEqual({ aspectRatio: "portrait", quality: "standard", style: "vivid" });
    });
  });
});
