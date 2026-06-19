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
  markSceneForRetry: vi.fn(),
}));
vi.mock("./db", () => ({
  createPage: vi.fn(),
  updatePage: vi.fn(),
  getBookPages: vi.fn(),
  createScene: vi.fn(),
  updateScene: vi.fn(),
  getBookScenes: vi.fn(),
  setBookGenerationMode: vi.fn(),
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
import { markSceneForRetry } from "./retryService";
import { createScene, updateScene, getBookScenes, setBookGenerationMode, updateBook } from "./db";
import { processBookPipelineScenes } from "./pipelineService";

const mExtractPages = vi.mocked(extractPDFPages);
const mThumb = vi.mocked(generatePageThumbnail);
const mOcr = vi.mocked(extractTextFromImage);
const mBible = vi.mocked(buildStoryContext);
const mScenePrompts = vi.mocked(generateScenePrompts);
const mGenImage = vi.mocked(generateImage);
const mStoragePut = vi.mocked(storagePut);
const mRetryScene = vi.mocked(markSceneForRetry);
const mCreateScene = vi.mocked(createScene);
const mUpdateScene = vi.mocked(updateScene);
const mGetBookScenes = vi.mocked(getBookScenes);
const mSetMode = vi.mocked(setBookGenerationMode);
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
  mGenImage.mockImplementation(
    async (opts: never) =>
      ({ url: "https://cdn/generated.png", key: `${(opts as { keyPrefix?: string }).keyPrefix}.png` } as never)
  );
  mGetBookScenes.mockResolvedValue([] as never);
  mCreateScene.mockImplementation(async (sc: never) => ({ id: 99, ...(sc as object) } as never));
  mUpdateScene.mockResolvedValue(undefined as never);
  mSetMode.mockResolvedValue(undefined as never);
  mUpdateBook.mockResolvedValue(undefined as never);
});

describe("processBookPipelineScenes (scenes table cut-over)", () => {
  it("flips the book onto scene mode and writes only to the scenes table", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(3) as never);

    const result = await processBookPipelineScenes(1, Buffer.from("pdf"));

    expect(result).toEqual({ successCount: 3, failureCount: 0, sceneCount: 3 });
    expect(mSetMode).toHaveBeenCalledWith(1, "scene");
    expect(mGenImage).toHaveBeenCalledTimes(3);
    expect(mCreateScene).toHaveBeenCalledTimes(3);
    // Persisted with 0-based sceneIndex and real titles (no synthetic page rows).
    const indices = mCreateScene.mock.calls.map((c) => (c[0] as { sceneIndex: number }).sceneIndex);
    expect(indices).toEqual([0, 1, 2]);
    const titles = mCreateScene.mock.calls.map((c) => (c[0] as { title: string }).title);
    expect(titles).toEqual(["Scene 1", "Scene 2", "Scene 3"]);
    expect(mUpdateBook).toHaveBeenLastCalledWith(1, { processingStatus: "completed" });
  });

  it("captures structured generation context on each scene row", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(1) as never);

    await processBookPipelineScenes(1, Buffer.from("pdf"));

    const row = mCreateScene.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      bookId: 1,
      sceneIndex: 0,
      title: "Scene 1",
      sourcePage: 1,
      rationale: "because 1",
      description: "description 1",
      prompt: "prompt 1",
      processingStatus: "done",
    });
    // generationParams is a JSON string carrying art-direction (style + mood)
    // plus the resolved render params (aspect/quality/style) actually used.
    expect(JSON.parse(row.generationParams as string)).toEqual({
      style: "oil painting",
      mood: "epic",
      render: { aspectRatio: "square", quality: "standard", style: "vivid" },
    });
  });

  it("persists the generated image under a book-scoped key and records the real key", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(2) as never);

    await processBookPipelineScenes(7, Buffer.from("pdf"));

    // Image generator is asked to store under a per-scene, book-scoped prefix
    // (not a fabricated flat key) so the recorded file key matches reality.
    const prefixes = mGenImage.mock.calls.map(
      (c) => (c[0] as { keyPrefix?: string }).keyPrefix
    );
    expect(prefixes).toEqual([
      "books/7/scenes/0/generated",
      "books/7/scenes/1/generated",
    ]);
    // The scene rows record the key the generator actually stored to.
    const keys = mCreateScene.mock.calls.map(
      (c) => (c[0] as { generatedImageFileKey?: string }).generatedImageFileKey
    );
    expect(keys).toEqual([
      "books/7/scenes/0/generated.png",
      "books/7/scenes/1/generated.png",
    ]);
  });

  it("upholds the OCR decoupling invariant — never calls OCR in scene mode", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(2) as never);

    await processBookPipelineScenes(1, Buffer.from("pdf"));

    expect(mOcr).not.toHaveBeenCalled();
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
    expect(mRetryScene).toHaveBeenCalledTimes(1);
    expect(mUpdateBook).toHaveBeenLastCalledWith(1, { processingStatus: "completed" });
  });

  it("fails the book when no illustratable scenes are found", async () => {
    mScenePrompts.mockResolvedValue([] as never);

    const result = await processBookPipelineScenes(1, Buffer.from("pdf"));

    expect(result).toEqual({ successCount: 0, failureCount: 0, sceneCount: 0 });
    expect(mGenImage).not.toHaveBeenCalled();
    expect(mCreateScene).not.toHaveBeenCalled();
    expect(mUpdateBook).toHaveBeenLastCalledWith(1, { processingStatus: "failed" });
  });

  it("skips already-rendered scenes on re-run and updates rather than duplicates", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(3) as never);
    // Scene index 0 already done from a previous run.
    mGetBookScenes.mockResolvedValue([
      { id: 1, sceneIndex: 0, processingStatus: "done" },
    ] as never);

    const result = await processBookPipelineScenes(1, Buffer.from("pdf"));

    expect(result).toEqual({ successCount: 3, failureCount: 0, sceneCount: 3 });
    // Only scenes 1 and 2 are re-generated.
    expect(mGenImage).toHaveBeenCalledTimes(2);
  });
});

describe("processBookPipelineScenes (user-supplied render params)", () => {
  it("threads custom image params to the generator and records them per scene", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(2) as never);

    await processBookPipelineScenes(1, Buffer.from("pdf"), undefined, {
      aspectRatio: "landscape",
      quality: "hd",
      style: "natural",
    });

    // Every scene is rendered with the user's chosen params (resolved once,
    // shared across the book) — not the hardcoded defaults.
    expect(mGenImage).toHaveBeenCalledTimes(2);
    for (const call of mGenImage.mock.calls) {
      expect((call[0] as { params?: unknown }).params).toEqual({
        aspectRatio: "landscape",
        quality: "hd",
        style: "natural",
      });
    }
    // The resolved render params are recorded on each scene row for audit.
    const renders = mCreateScene.mock.calls.map(
      (c) => JSON.parse((c[0] as { generationParams: string }).generationParams).render
    );
    expect(renders).toEqual([
      { aspectRatio: "landscape", quality: "hd", style: "natural" },
      { aspectRatio: "landscape", quality: "hd", style: "natural" },
    ]);
  });

  it("normalizes partial params, defaulting omitted fields", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(1) as never);

    await processBookPipelineScenes(1, Buffer.from("pdf"), undefined, {
      aspectRatio: "portrait",
    });

    // aspectRatio honored; quality + style fall back to defaults.
    expect((mGenImage.mock.calls[0][0] as { params?: unknown }).params).toEqual({
      aspectRatio: "portrait",
      quality: "standard",
      style: "vivid",
    });
  });

  it("falls back to default params when none are supplied", async () => {
    mScenePrompts.mockResolvedValue(sceneArray(1) as never);

    await processBookPipelineScenes(1, Buffer.from("pdf"));

    expect((mGenImage.mock.calls[0][0] as { params?: unknown }).params).toEqual({
      aspectRatio: "square",
      quality: "standard",
      style: "vivid",
    });
  });
});
