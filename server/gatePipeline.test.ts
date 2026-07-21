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
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { extractPDFPages } from "./pdfService";
import { buildStoryContext, generateImagePrompt } from "./promptService";
import { generateImage } from "./_core/imageGeneration";
import { invokeLLM } from "./_core/llm";
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
const mLlm = vi.mocked(invokeLLM);

function offlineJson(payload: unknown) {
  return {
    id: "t",
    created: 0,
    model: "test",
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: JSON.stringify(payload) },
        finish_reason: "stop" as const,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mGetBook.mockResolvedValue({
    id: 1,
    userId: 1,
    pageCount: 2,
    processingStatus: "pending",
    storyBible: null,
  } as any);
  mLlm.mockImplementation(async (params: any) => {
    const name = params?.response_format?.json_schema?.name;
    if (name === "book_genres") {
      return offlineJson({
        genres: ["narrative fiction"],
        confidence: "high",
        notes: "test",
      }) as any;
    }
    if (name === "plot_map") {
      return offlineJson({
        authorIntent: "Illustrate the journey",
        plotUnits: [
          {
            unitIndex: 0,
            sourcePageFrom: 1,
            sourcePageTo: 1,
            role: "main",
            title: "Opening",
            rationale: "main beat",
          },
          {
            unitIndex: 1,
            sourcePageFrom: 2,
            sourcePageTo: 2,
            role: "main",
            title: "Arrival",
            rationale: "main beat",
          },
        ],
      }) as any;
    }
    return offlineJson({}) as any;
  });
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
  it("multi-pass: persists bible + readingProfile and sets prompt_ready on main units", async () => {
    const bible = {
      artStyle: "oil",
      characters: [],
      factions: [],
      locations: [],
      keyObjects: [],
      chronology: [],
      visualMotifs: [],
      relationships: [],
      tone: "n",
      setting: "s",
      timePeriod: "t",
      narrativeSummary: "sum",
    };
    mGetPages.mockResolvedValue([
      {
        id: 10,
        pageNumber: 1,
        ocrText:
          "Chapter 1\nOnce upon a time in a riverside town with plenty of words for the chapter",
        promptStatus: "pending",
      },
      {
        id: 11,
        pageNumber: 2,
        ocrText:
          "Chapter 2\nCaptain Ellis arrived with a weathered map of the coast and a plan",
        promptStatus: "pending",
      },
    ] as any);
    mBible.mockResolvedValue(bible as any);
    mGetBook.mockResolvedValue({ id: 1, storyBible: bible, packageTier: "lite" } as any);
    mPrompt.mockResolvedValue({ prompt: "LLM prompt", style: "oil", mood: "calm" });

    const result = await transcribeBook(1);

    expect(mBible).toHaveBeenCalledTimes(1);
    expect(mUpdateBook).toHaveBeenCalledWith(1, { storyBible: bible });
    expect(mUpdateBook).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        readingProfile: expect.objectContaining({
          packageTier: "lite",
          genres: expect.arrayContaining(["narrative fiction"]),
          chapters: expect.any(Array),
          authorIntent: expect.any(String),
        }),
      })
    );
    // Lite: one prompt per chapter (two Chapter headings → two prompts)
    expect(mPrompt).toHaveBeenCalledTimes(2);
    expect(mUpdatePage).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        promptStatus: "prompt_ready",
        generatedPrompt: "LLM prompt",
        promptStructured: expect.objectContaining({ packageTier: "lite" }),
      })
    );
    expect(result.biblePersisted).toBe(true);
    expect(result.genres).toEqual(["narrative fiction"]);
    expect(result.packageTier).toBe("lite");
    expect(result.chapterCount).toBe(2);
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

  it("bar §4: render never calls generateImagePrompt (uses persisted prompt only)", async () => {
    mGetPages.mockResolvedValue([
      {
        id: 10,
        pageNumber: 1,
        promptStatus: "approved",
        generatedPrompt: "PERSISTED_PROMPT_BYTE_IDENTITY",
        imageStatus: "pending",
        skipSuggested: false,
      },
    ] as any);
    mGen.mockResolvedValue({
      url: "https://cdn/g.png",
      key: "books/1/pages/1/generated.png",
    });

    await renderApprovedImages(1);

    expect(mPrompt).not.toHaveBeenCalled();
    expect(mBible).not.toHaveBeenCalled();
    expect(mGen).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "PERSISTED_PROMPT_BYTE_IDENTITY" })
    );
  });
});

describe("reRenderApprovedPage (retry path, bar §5)", () => {
  it("re-renders from persisted prompt and refuses non-approved", async () => {
    const { reRenderApprovedPage } = await import("./gatePipeline");

    mGetPage.mockResolvedValue({
      id: 10,
      bookId: 1,
      pageNumber: 1,
      promptStatus: "prompt_ready",
      generatedPrompt: "should not render",
    } as any);
    await expect(reRenderApprovedPage(10)).rejects.toThrow(/refusing to regenerate/);

    mGetPage.mockResolvedValue({
      id: 10,
      bookId: 1,
      pageNumber: 1,
      promptStatus: "approved",
      generatedPrompt: "LOCKED_PROMPT",
    } as any);
    mGen.mockResolvedValue({ url: "https://cdn/r.png", key: "books/1/pages/1/generated.png" });

    const r = await reRenderApprovedPage(10);
    expect(r.key).toBe("books/1/pages/1/generated.png");
    expect(mPrompt).not.toHaveBeenCalled();
    expect(mGen).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "LOCKED_PROMPT" })
    );
  });
});
