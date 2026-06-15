import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest). The scene-based pipeline depends on PDF
// extraction, the story-bible builder, the scene planner, the image generator,
// storage, and the DB. All are stubbed so the tests are hermetic and spend no
// money — no real image-generation API is ever called.
// ---------------------------------------------------------------------------
vi.mock("./pdfService", () => ({
  extractPDFPages: vi.fn(),
  generatePageThumbnail: vi.fn(),
}));
vi.mock("./ocrService", () => ({
  extractTextFromImage: vi.fn(),
}));
vi.mock("./promptService", () => ({
  buildStoryContext: vi.fn(),
  generateImagePrompt: vi.fn(),
  generateImagePromptsWithContext: vi.fn(),
}));
vi.mock("./scenePlanner", () => ({
  generateScenePrompts: vi.fn(),
}));
vi.mock("./_core/imageGeneration", () => ({
  generateImage: vi.fn(),
}));
vi.mock("./storage", () => ({
  storagePut: vi.fn(),
}));
vi.mock("./retryService", () => ({
  markPageForRetry: vi.fn(),
}));
vi.mock("./db", () => ({
  createPage: vi.fn(),
  updatePage: vi.fn(),
  getBookPages: vi.fn(),
  createProcessingJob: vi.fn(),
  updateProcessingJob: vi.fn(),
  updateBook: vi.fn(),
}));

import { extractPDFPages, generatePageThumbnail } from "./pdfService";
import { extractTextFromImage } from "./ocrService";
import { buildStoryContext } from "./promptService";
import { generateScenePrompts } from "./scenePlanner";
import { generateImage } from "./_core/imageGeneration";
import { storagePut } from "./storage";
import { markPageForRetry } from "./retryService";
import { createPage, updatePage, getBookPages, updateBook } from "./db";
import { processBookPipelineScenes } from "./pipelineService";

const mExtractPages = vi.mocked(extractPDFPages);
const mThumb = vi.mocked(generatePageThumbnail);
const mOcr = vi.mocked(extractTextFromImage);
const mBible = vi.mocked(buildStoryContext);
const mScenePrompts = vi.mocked(generateScenePrompts);
const mGenImage = vi.mocked(generateImage);
const mStoragePut = vi.mocked(storagePut);
const mRetry = vi.mocked(markPageForRetry);
const mCreatePage = vi.mocked(createPage);
const mUpdatePage = vi.mocked(updatePage);
const mGetBookPages = vi.mocked(getBookPages);
const mUpdateBook = vi.mocked(updateBook);

function sceneArray(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    prompt: `prompt ${i + 1}`,
    style: "oil painting",
    mood: "epic",
    scene: {
      sourcePage: i + 1,
      title: `Scene ${i + 1}`,
      description: `description ${i + 1}`,
      rationale: `because ${i + 1}`,
      importance: 3,
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path stubs.
  mExtractPages.mockResolvedValue({
    totalPages: 4,
    pages: [
      { pageNumber: 1, text: "page one text long enough to matter" },
      { pageNumber: 2, text: "page two text long enough to matter" },
      { pageNumber: 3, text: "page three text long enough to matter" },
      { pageNumber: 4, text: "page four text long enough to matter" },
    ],
  } as never);
  mThumb.mockResolvedValue(Buffer.from("thumb") as never);
  mStoragePut.mockResolvedValue({ url: "https://cdn/thumb.png" } as never);
  mBible.mockResolvedValue({ tone: "epic", artStyle: "oil", narrativeSummary: "arc" } as never);
  mGenImage.mockResolvedValue({ url: "https://cdn/generated.png" } as never);
  mGetBookPages.mockResolvedValue([] as never);
  mCreatePage.mockImplementation(async (p: never) => ({ id: 99, ...(p as object) } as never));
  mUpdatePage.mockResolvedValue(undefined as never);
  mUpdateBook.mockResolvedValue(undefined as never);
});

describe("processBookPipelineScenes", () => {
  it("renders one image per planned scene and persists sequential scene rows", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(3) as never);

    const result = await processBookPipelineScenes(1, Buffer.from("pdf"));

    expect(result).toEqual({ successCount: 3, failureCount: 0, sceneCount: 3 });
    expect(mGenImage).toHaveBeenCalledTimes(3);
    expect(mCreatePage).toHaveBeenCalledTimes(3);
    // Persisted with sequential pageNumber = scene ordinal (interim mapping).
    const pageNumbers = mCreatePage.mock.calls.map((c) => (c[0] as { pageNumber: number }).pageNumber);
    expect(pageNumbers).toEqual([1, 2, 3]);
    expect(mUpdateBook).toHaveBeenLastCalledWith(1, { processingStatus: "completed" });
  });

  it("upholds the OCR decoupling invariant — never calls OCR in scene mode", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(2) as never);

    await processBookPipelineScenes(1, Buffer.from("pdf"));

    // Scene planning consumes already-extracted text + the bible. The pipeline
    // must NOT re-run OCR (extractTextFromImage) — that would recouple them.
    expect(mOcr).not.toHaveBeenCalled();
    // Planner is fed the extracted page texts and the story bible.
    const [texts, ctx] = mScenePrompts.mock.calls[0];
    expect(texts).toHaveLength(4);
    expect(ctx).toMatchObject({ artStyle: "oil" });
  });

  it("marks a failed scene for retry but still completes the book", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(3) as never);
    mGenImage
      .mockResolvedValueOnce({ url: "https://cdn/1.png" } as never)
      .mockRejectedValueOnce(new Error("image API down") as never)
      .mockResolvedValueOnce({ url: "https://cdn/3.png" } as never);

    const result = await processBookPipelineScenes(1, Buffer.from("pdf"));

    expect(result).toEqual({ successCount: 2, failureCount: 1, sceneCount: 3 });
    expect(mRetry).toHaveBeenCalledTimes(1);
    expect(mUpdateBook).toHaveBeenLastCalledWith(1, { processingStatus: "completed" });
  });

  it("fails the book when no illustratable scenes are found", async () => {
    mScenePrompts.mockResolvedValue([] as never);

    const result = await processBookPipelineScenes(1, Buffer.from("pdf"));

    expect(result).toEqual({ successCount: 0, failureCount: 0, sceneCount: 0 });
    expect(mGenImage).not.toHaveBeenCalled();
    expect(mUpdateBook).toHaveBeenLastCalledWith(1, { processingStatus: "failed" });
  });

  it("skips already-rendered scenes on re-run (idempotent)", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(3) as never);
    // Scene ordinal 1 already done from a previous run.
    mGetBookPages.mockResolvedValue([
      { id: 1, pageNumber: 1, processingStatus: "done" },
    ] as never);

    const result = await processBookPipelineScenes(1, Buffer.from("pdf"));

    expect(result).toEqual({ successCount: 3, failureCount: 0, sceneCount: 3 });
    // Only scenes 2 and 3 are re-generated.
    expect(mGenImage).toHaveBeenCalledTimes(2);
  });
});
