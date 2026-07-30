import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest). processPagePipeline is the single-page,
// from-scratch pipeline the automatic retry worker (retryWorker.ts) invokes
// on every retry. All external boundaries are stubbed so tests are hermetic
// and spend no money -- no real image-generation API is ever called.
//
// extractSinglePageText (pdfjs text-layer extraction) replaces what used to
// be a Tesseract OCR call against generatePageThumbnail's output. That output
// is a hardcoded 1x1 PNG (see pdfService.ts), so the old call could only ever
// return empty text -- and since this path runs on every retry, it would
// silently blank out a page's real, previously-extracted text. ocrService is
// still mocked and asserted un-called below to prove that bug can't recur.
// ---------------------------------------------------------------------------
vi.mock("./pdfService", () => ({
  generatePageThumbnail: vi.fn(),
  extractSinglePageText: vi.fn(),
}));
vi.mock("./ocrService", () => ({
  extractTextFromImage: vi.fn(),
}));
vi.mock("./promptService", async (importOriginal) => {
  // Keep the real EmptyPageError class (tests below construct/throw it to
  // simulate promptService's real refuse-to-render behaviour) while stubbing
  // out the actual LLM-calling function.
  const actual = await importOriginal<typeof import("./promptService")>();
  return { ...actual, generateImagePrompt: vi.fn() };
});
vi.mock("./_core/imageGeneration", () => ({
  generateImage: vi.fn(),
}));
vi.mock("./storage", () => ({
  storagePut: vi.fn(),
}));
vi.mock("./retryService", () => ({
  markPageForRetry: vi.fn(),
  markSceneForRetry: vi.fn(),
}));
vi.mock("./db", () => ({
  createPage: vi.fn(),
  updatePage: vi.fn(),
  getBookPages: vi.fn(),
}));

import { generatePageThumbnail, extractSinglePageText } from "./pdfService";
import { extractTextFromImage } from "./ocrService";
import { generateImagePrompt, EmptyPageError } from "./promptService";
import { generateImage } from "./_core/imageGeneration";
import { storagePut } from "./storage";
import { markPageForRetry } from "./retryService";
import { createPage, updatePage, getBookPages } from "./db";
import { processPagePipeline } from "./pipelineService";

const mThumb = vi.mocked(generatePageThumbnail);
const mSinglePageText = vi.mocked(extractSinglePageText);
const mOcr = vi.mocked(extractTextFromImage);
const mPrompt = vi.mocked(generateImagePrompt);
const mGenImage = vi.mocked(generateImage);
const mStoragePut = vi.mocked(storagePut);
const mRetryPage = vi.mocked(markPageForRetry);
const mCreatePage = vi.mocked(createPage);
const mUpdatePage = vi.mocked(updatePage);
const mGetBookPages = vi.mocked(getBookPages);

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path stubs.
  mThumb.mockResolvedValue(Buffer.from("thumb") as never);
  mStoragePut.mockResolvedValue({ url: "https://cdn/thumb.png" } as never);
  mSinglePageText.mockResolvedValue("the real page text");
  mPrompt.mockResolvedValue({ prompt: "a fantasy illustration", mood: "epic" } as never);
  mGenImage.mockImplementation(
    async (opts) => ({ url: "https://cdn/generated.png", key: `${opts.keyPrefix}.png` } as never)
  );
  mGetBookPages.mockResolvedValue([] as never);
  mCreatePage.mockImplementation(async (p) => ({ id: 1, ...p } as never));
  mUpdatePage.mockResolvedValue(undefined as never);
});

describe("processPagePipeline (single-page retry path)", () => {
  it("derives page text via pdfjs extraction, never via Tesseract OCR", async () => {
    const pdfBuffer = Buffer.from("pdf");

    await processPagePipeline(1, 3, pdfBuffer);

    expect(mSinglePageText).toHaveBeenCalledWith(pdfBuffer, 3);
    expect(mOcr).not.toHaveBeenCalled();
  });

  it("passes the extracted text to prompt generation and persists it on the page", async () => {
    mSinglePageText.mockResolvedValue("Chapter Three: the storm arrives");

    await processPagePipeline(1, 3, Buffer.from("pdf"));

    expect(mPrompt).toHaveBeenCalledWith("Chapter Three: the storm arrives", 3, undefined, undefined);
    expect(mCreatePage).toHaveBeenCalledWith(
      expect.objectContaining({ ocrText: "Chapter Three: the storm arrives", processingStatus: "done" })
    );
  });

  it("re-derives text per page number -- no stale or blank input across retries", async () => {
    mSinglePageText.mockImplementation(async (_buf, pageNumber) => `text for page ${pageNumber}`);

    await processPagePipeline(1, 7, Buffer.from("pdf"));

    expect(mPrompt).toHaveBeenCalledWith("text for page 7", 7, undefined, undefined);
  });

  it("updates rather than duplicates an existing page row on retry (upsert)", async () => {
    mGetBookPages.mockResolvedValue([
      { id: 42, bookId: 1, pageNumber: 3, processingStatus: "error" },
    ] as never);

    await processPagePipeline(1, 3, Buffer.from("pdf"));

    expect(mUpdatePage).toHaveBeenCalledWith(42, expect.objectContaining({ processingStatus: "done" }));
    expect(mCreatePage).not.toHaveBeenCalled();
  });

  it("schedules a retry and rethrows when image generation fails", async () => {
    mGenImage.mockRejectedValueOnce(new Error("image API down"));
    mCreatePage.mockResolvedValueOnce({ id: 5 } as never);

    await expect(processPagePipeline(1, 3, Buffer.from("pdf"))).rejects.toThrow("image API down");

    expect(mRetryPage).toHaveBeenCalledWith(
      5,
      1,
      expect.stringContaining("image API down"),
      expect.any(String)
    );
  });

  it("marks the page as permanently failed (no auto-retry) when the page has no extractable text", async () => {
    mSinglePageText.mockResolvedValue("");
    mPrompt.mockRejectedValueOnce(new EmptyPageError(3));
    mCreatePage.mockResolvedValueOnce({ id: 9 } as never);

    await expect(processPagePipeline(1, 3, Buffer.from("pdf"))).rejects.toThrow(EmptyPageError);

    expect(mCreatePage).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 1, pageNumber: 3, processingStatus: "error" })
    );
    // Unlike an image-generation failure, this is not retryable -- the text
    // will still be absent next time -- so no retry should be scheduled.
    expect(mRetryPage).not.toHaveBeenCalled();
    expect(mGenImage).not.toHaveBeenCalled();
  });

  it("render boundary: the image generator receives prompt + keyPrefix + params only, never raw page text", async () => {
    mSinglePageText.mockResolvedValue("secret raw page text that must not leak");

    await processPagePipeline(1, 3, Buffer.from("pdf"));

    expect(mGenImage).toHaveBeenCalledTimes(1);
    const args = mGenImage.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["keyPrefix", "params", "prompt"]);
    expect(JSON.stringify(args)).not.toContain("secret raw page text");
  });
});
