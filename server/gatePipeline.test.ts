import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./pdfService", () => ({
  extractPDFPages: vi.fn(),
  generatePageThumbnail: vi.fn().mockResolvedValue(Buffer.from("thumb")),
}));
vi.mock("./promptService", () => ({
  buildStoryContext: vi.fn(),
  generateImagePrompt: vi.fn(),
  EmptyPageError: class EmptyPageError extends Error {
    constructor(public pageNumber?: number) {
      super("empty");
      this.name = "EmptyPageError";
    }
  },
}));
vi.mock("./_core/imageGeneration", () => ({
  generateImage: vi.fn(),
}));
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://cdn/x", key: "k" }),
}));
vi.mock("./db", () => ({
  createPage: vi.fn(),
  updatePage: vi.fn(),
  getBookPages: vi.fn(),
  getBook: vi.fn(),
  updateBook: vi.fn(),
  getPage: vi.fn(),
}));

import { extractPDFPages } from "./pdfService";
import { buildStoryContext, generateImagePrompt } from "./promptService";
import { generateImage } from "./_core/imageGeneration";
import {
  createPage,
  updatePage,
  getBookPages,
  getBook,
  updateBook,
  getPage,
} from "./db";
import {
  extractAndStorePages,
  transcribeBook,
  setPagePromptApproval,
  renderApprovedImages,
} from "./gatePipeline";

const mExtract = vi.mocked(extractPDFPages);
const mBible = vi.mocked(buildStoryContext);
const mPrompt = vi.mocked(generateImagePrompt);
const mGen = vi.mocked(generateImage);
const mCreatePage = vi.mocked(createPage);
const mUpdatePage = vi.mocked(updatePage);
const mGetPages = vi.mocked(getBookPages);
const mGetBook = vi.mocked(getBook);
const mUpdateBook = vi.mocked(updateBook);
const mGetPage = vi.mocked(getPage);

beforeEach(() => {
  vi.clearAllMocks();
  mGetBook.mockResolvedValue({
    id: 1,
    userId: 1,
    pageCount: 2,
    processingStatus: "pending",
    storyBible: null,
  } as any);
});

describe("extractAndStorePages", () => {
  it("writes page rows with OCR text and never calls generateImage", async () => {
    mExtract.mockResolvedValue({
      totalPages: 2,
      pages: [
        { pageNumber: 1, text: "Once upon a time in a riverside town", width: 1, height: 1 },
        { pageNumber: 2, text: "Captain Ellis arrived with a map", width: 1, height: 1 },
      ],
    } as any);
    mGetPages.mockResolvedValue([]);
    mCreatePage.mockResolvedValue({ id: 1 } as any);

    const result = await extractAndStorePages(1, Buffer.from("pdf"));

    expect(result.extracted).toBe(2);
    expect(mCreatePage).toHaveBeenCalledTimes(2);
    expect(mCreatePage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNumber: 1,
        ocrText: expect.stringContaining("riverside"),
        promptStatus: "pending",
        imageStatus: "pending",
      })
    );
    expect(mGen).not.toHaveBeenCalled();
  });
});

describe("transcribeBook", () => {
  it("persists storyBible once and sets prompt_ready", async () => {
    const bible = { artStyle: "oil", characters: [], factions: [], locations: [], keyObjects: [], chronology: [], visualMotifs: [], relationships: [], tone: "n", setting: "s", timePeriod: "t", narrativeSummary: "sum" };
    mGetPages.mockResolvedValue([
      { id: 10, pageNumber: 1, ocrText: "Once upon a time in a riverside town with plenty of words", promptStatus: "pending" },
      { id: 11, pageNumber: 2, ocrText: "Captain Ellis arrived with a weathered map of the coast", promptStatus: "pending" },
    ] as any);
    mBible.mockResolvedValue(bible as any);
    mGetBook
      .mockResolvedValueOnce({ id: 1, storyBible: null } as any)
      .mockResolvedValue({ id: 1, storyBible: bible } as any);
    mPrompt.mockResolvedValue({ prompt: "LLM prompt", style: "oil", mood: "calm" });

    const result = await transcribeBook(1);

    expect(mBible).toHaveBeenCalledTimes(1);
    expect(mUpdateBook).toHaveBeenCalledWith(1, { storyBible: bible });
    expect(mPrompt).toHaveBeenCalledTimes(2);
    expect(mUpdatePage).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ promptStatus: "prompt_ready", generatedPrompt: "LLM prompt" })
    );
    expect(result.biblePersisted).toBe(true);
    expect(mGen).not.toHaveBeenCalled();
  });
});

describe("setPagePromptApproval", () => {
  it("approves only prompt_ready pages with a prompt", async () => {
    mGetPage.mockResolvedValue({
      id: 10,
      promptStatus: "prompt_ready",
      generatedPrompt: "A riverside scene",
    } as any);
    const r = await setPagePromptApproval(10, true);
    expect(r.promptStatus).toBe("approved");
    expect(mUpdatePage).toHaveBeenCalledWith(10, { promptStatus: "approved" });
  });

  it("refuses approve when status is pending", async () => {
    mGetPage.mockResolvedValue({
      id: 10,
      promptStatus: "pending",
      generatedPrompt: "x",
    } as any);
    await expect(setPagePromptApproval(10, true)).rejects.toThrow(/prompt_ready/);
  });
});

describe("renderApprovedImages", () => {
  it("HARD GATE: skips non-approved pages even if they have prompts", async () => {
    mGetPages.mockResolvedValue([
      {
        id: 10,
        pageNumber: 1,
        promptStatus: "prompt_ready",
        generatedPrompt: "do not render me",
        imageStatus: "pending",
      },
    ] as any);

    const r = await renderApprovedImages(1);
    expect(r.rendered).toBe(0);
    expect(r.skipped).toBe(1);
    expect(mGen).not.toHaveBeenCalled();
  });

  it("renders approved pages and records the REAL storage key", async () => {
    mGetPages
      .mockResolvedValueOnce([
        {
          id: 10,
          pageNumber: 1,
          promptStatus: "approved",
          generatedPrompt: "A riverside oil painting",
          imageStatus: "pending",
          skipSuggested: false,
        },
      ] as any)
      .mockResolvedValue([
        {
          id: 10,
          pageNumber: 1,
          promptStatus: "approved",
          imageStatus: "image_ready",
        },
      ] as any);
    mGen.mockResolvedValue({
      url: "https://cdn/books/1/pages/1/generated.png",
      key: "books/1/pages/1/generated.png",
    });

    const r = await renderApprovedImages(1);
    expect(r.rendered).toBe(1);
    expect(mGen).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "A riverside oil painting",
        keyPrefix: "books/1/pages/1/generated",
      })
    );
    expect(mUpdatePage).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        generatedImageFileKey: "books/1/pages/1/generated.png",
        generatedImageUrl: "https://cdn/books/1/pages/1/generated.png",
        imageStatus: "image_ready",
        processingStatus: "done",
      })
    );
  });

  it("refuses image_ready when generateImage omits key", async () => {
    mGetPages.mockResolvedValue([
      {
        id: 10,
        pageNumber: 1,
        promptStatus: "approved",
        generatedPrompt: "scene",
        imageStatus: "pending",
        skipSuggested: false,
      },
    ] as any);
    mGen.mockResolvedValue({ url: "https://cdn/x.png" }); // no key

    const r = await renderApprovedImages(1);
    expect(r.errors).toBe(1);
    expect(mUpdatePage).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ imageStatus: "image_error" })
    );
  });
});
