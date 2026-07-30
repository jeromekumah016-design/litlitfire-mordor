import { describe, it, expect } from "vitest";
import * as pipelineService from "./pipelineService";

/**
 * HISTORICAL NOTE (2026-07-18): this file used to test getOcrTextCached, a
 * wrapper that cached Tesseract OCR results keyed on a rendered thumbnail.
 * That wrapper was removed: its only call site (processPagePipeline) fed it
 * generatePageThumbnail's output, which is a hardcoded 1x1 PNG (see
 * pdfService.ts) -- so every Tesseract call it cached was guaranteed to
 * return empty/garbage text, and worse, on every automatic retry it would
 * silently overwrite that page's real, previously-extracted text with the
 * empty result. processPagePipeline now uses pdfService.extractSinglePageText
 * (real pdfjs text-layer extraction -- the same mechanism the main pipeline
 * uses) instead. See:
 *  - server/pipelineService.singlePage.test.ts (replacement coverage for
 *    processPagePipeline's text-derivation and render-boundary behavior)
 *  - server/pdfService.test.ts's "extractSinglePageText" describe block
 *  - STATUS_LOG.md / sprint-log.md, 2026-07-18 entry
 *
 * ocrCacheService.ts + ocrCacheService.test.ts are untouched -- the generic
 * TTL cache is still sound, reusable infra for a future real Tesseract
 * fallback once server-side page rasterization actually exists.
 *
 * This file could not be deleted outright: the sandbox filesystem refused
 * unlink() (and rename()) with EPERM for this specific path -- same class of
 * issue as the long-standing unremovable .git/*.lock files noted throughout
 * this repo's STATUS_LOG. Repurposed in place as a regression guard instead
 * of leaving broken content (which imported the now-removed function)
 * behind.
 */
describe("pipelineService -- OCR caching wrapper intentionally removed", () => {
  it("no longer exports getOcrTextCached (removed 2026-07-18; see note above)", () => {
    expect((pipelineService as Record<string, unknown>).getOcrTextCached).toBeUndefined();
  });
});
