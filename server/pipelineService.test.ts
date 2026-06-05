import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the legacy single-page pipeline (processPagePipeline), which the
 * retry worker uses to reprocess a failed page.
 *
 * 1. On image-generation failure it must persist exactly ONE error row (and one
 *    retry) — not two. (The image-gen catch records the row + retry and throws
 *    a sentinel; the function-level catch must not write again.)
 * 2. It must derive page text from the PDF text layer (extractPDFPages), NOT by
 *    OCR'ing the placeholder thumbnail — otherwise a retry would overwrite the
 *    page's real text with a blank "empty page".
 */

const createPage = vi.fn(async (page: Record<string, unknown>) => ({
  id: 42,
  ...page,
}));
const markPageForRetry = vi.fn(async () => undefined);
const generateImage = vi.fn();
const extractTextFromImage = vi.fn(async () => ({ text: "FROM OCR (should not be used)" }));

vi.mock("./pdfService", () => ({
  generatePageThumbnail: vi.fn(async () => Buffer.from("thumb")),
  extractPDFPages: vi.fn(async () => ({
    totalPages: 1,
    pages: [{ pageNumber: 1, text: "real text-layer content", width: 1, height: 1 }],
  })),
}));
vi.mock("./ocrService", () => ({
  extractTextFromImage: (...a: unknown[]) => extractTextFromImage(...a),
}));
vi.mock("./promptService", () => ({
  generateImagePrompt: vi.fn(async (text: string) => ({
    prompt: `prompt for: ${text}`,
    style: "s",
    mood: "m",
  })),
  generateImagePromptsWithContext: vi.fn(async () => []),
  buildStoryContext: vi.fn(async () => null),
}));
vi.mock("./_core/imageGeneration", () => ({
  generateImage: (...a: unknown[]) => generateImage(...a),
}));
vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ url: `https://cdn/${key}` })),
}));
vi.mock("./db", () => ({
  createPage: (...args: unknown[]) => createPage(...(args as [Record<string, unknown>])),
  updatePage: vi.fn(async () => undefined),
  createProcessingJob: vi.fn(async () => ({ id: 1 })),
  updateProcessingJob: vi.fn(async () => undefined),
  updateBook: vi.fn(async () => undefined),
}));
vi.mock("./retryService", () => ({
  markPageForRetry: (...args: unknown[]) => markPageForRetry(...args),
}));

describe("processPagePipeline (retry path)", () => {
  beforeEach(() => {
    createPage.mockClear();
    markPageForRetry.mockClear();
    generateImage.mockReset();
    extractTextFromImage.mockClear();
  });

  it("records exactly one error row and one retry when image generation fails", async () => {
    generateImage.mockRejectedValue(new Error("boom: image API down"));
    const { processPagePipeline } = await import("./pipelineService");

    await expect(processPagePipeline(1, 1, Buffer.from("pdf"))).rejects.toThrow(
      /boom: image API down/
    );

    expect(createPage).toHaveBeenCalledTimes(1);
    expect(createPage.mock.calls[0][0]).toMatchObject({
      bookId: 1,
      pageNumber: 1,
      processingStatus: "error",
    });
    expect(markPageForRetry).toHaveBeenCalledTimes(1);
  });

  it("uses the PDF text layer, not OCR on the placeholder thumbnail", async () => {
    generateImage.mockResolvedValue({ url: "https://img/generated.png" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }))
    );
    const { processPagePipeline } = await import("./pipelineService");

    await processPagePipeline(1, 1, Buffer.from("pdf"));

    // OCR on the blank thumbnail must NOT be the text source.
    expect(extractTextFromImage).not.toHaveBeenCalled();
    expect(createPage).toHaveBeenCalledTimes(1);
    expect(createPage.mock.calls[0][0]).toMatchObject({
      processingStatus: "done",
      ocrText: "real text-layer content",
      generatedPrompt: "prompt for: real text-layer content",
    });

    vi.unstubAllGlobals();
  });
});
