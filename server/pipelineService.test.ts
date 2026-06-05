import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test: when image generation fails for a page, the pipeline must
 * persist exactly ONE error row (and schedule one retry) — not two. Previously
 * the image-generation catch created an error row + retry and then re-threw,
 * and the function-level catch created a second duplicate error row.
 */

const createPage = vi.fn(async (page: Record<string, unknown>) => ({
  id: 42,
  ...page,
}));
const markPageForRetry = vi.fn(async () => undefined);

vi.mock("./pdfService", () => ({
  generatePageThumbnail: vi.fn(async () => Buffer.from("thumb")),
  extractPDFPages: vi.fn(async () => ({ totalPages: 1, pages: [{ text: "hi" }] })),
}));
vi.mock("./ocrService", () => ({
  extractTextFromImage: vi.fn(async () => ({ text: "page text" })),
}));
vi.mock("./promptService", () => ({
  generateImagePrompt: vi.fn(async () => ({ prompt: "p", style: "s", mood: "m" })),
  generateImagePromptsWithContext: vi.fn(async () => []),
  buildStoryContext: vi.fn(async () => null),
}));
vi.mock("./_core/imageGeneration", () => ({
  generateImage: vi.fn(async () => {
    throw new Error("boom: image API down");
  }),
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

describe("processPagePipeline image-generation failure", () => {
  beforeEach(() => {
    createPage.mockClear();
    markPageForRetry.mockClear();
  });

  it("records exactly one error row and one retry when image generation fails", async () => {
    const { processPagePipeline } = await import("./pipelineService");

    await expect(
      processPagePipeline(1, 1, Buffer.from("pdf"))
    ).rejects.toThrow(/boom: image API down/);

    expect(createPage).toHaveBeenCalledTimes(1);
    expect(createPage.mock.calls[0][0]).toMatchObject({
      bookId: 1,
      pageNumber: 1,
      processingStatus: "error",
    });
    expect(markPageForRetry).toHaveBeenCalledTimes(1);
  });
});
