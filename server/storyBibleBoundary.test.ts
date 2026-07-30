import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Story-bible consistency + transcribe/render phase boundary.
//
// The HARD INVARIANT of this codebase: OCR transcription stays decoupled from
// image generation; the story bible (StoryContext) is the sole mediator.
// These tests pin down, with real promptService + pipelineService code and a
// mocked LLM/render boundary, that:
//   1. the bible is built exactly ONCE per book and reused for every page,
//   2. locked visual fields (artStyle, character descriptions, locations,
//      motifs) appear IDENTICALLY in every page's prompt — no drift,
//   3. the chronology gate never leaks future events into an earlier page,
//   4. a bible-build failure degrades gracefully (book still completes),
//   5. the image generator only ever receives the mediated prompt + render
//      params — never raw OCR/page text.
// No real network calls; zero spend.
// ---------------------------------------------------------------------------
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./_core/env", () => ({ ENV: { sceneModeEnabled: false } }));
vi.mock("./pdfService", () => ({
  extractPDFPages: vi.fn(),
  generatePageThumbnail: vi.fn(),
}));
vi.mock("./ocrService", () => ({ extractTextFromImage: vi.fn() }));
vi.mock("./_core/imageGeneration", () => ({ generateImage: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));
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

import { invokeLLM } from "./_core/llm";
import { extractPDFPages, generatePageThumbnail } from "./pdfService";
import { extractTextFromImage } from "./ocrService";
import { generateImage } from "./_core/imageGeneration";
import { storagePut } from "./storage";
import { markPageForRetry } from "./retryService";
import { createPage, getBookPages, updateBook } from "./db";
import {
  buildStoryContext,
  generateImagePrompt,
  generateImagePromptsWithContext,
  EmptyPageError,
  type StoryContext,
} from "./promptService";
import { processBookPipeline } from "./pipelineService";

const mLLM = vi.mocked(invokeLLM);
const mExtractPages = vi.mocked(extractPDFPages);
const mThumb = vi.mocked(generatePageThumbnail);
const mOcr = vi.mocked(extractTextFromImage);
const mGenImage = vi.mocked(generateImage);
const mStoragePut = vi.mocked(storagePut);
const mCreatePage = vi.mocked(createPage);
const mGetBookPages = vi.mocked(getBookPages);
const mUpdateBook = vi.mocked(updateBook);
const mRetryPage = vi.mocked(markPageForRetry);

// ── Locked bible fixture ────────────────────────────────────────────────────
const LOCKED_ART_STYLE =
  "classical oil painting in the style of Gustave Dore, dramatic chiaroscuro, warm sepia and gold";
const MOSES_LOOK =
  "a tall man of 80 with a long white beard, weathered bronze skin, a striped red-and-brown robe, and a wooden staff";
const AARON_LOOK =
  "a broad-shouldered man of 83 with a grey beard, white linen priestly garments, and a golden breastplate";

function bible(): StoryContext {
  return {
    characters: [
      { name: "Moses", visualDescription: MOSES_LOOK, role: "protagonist", relationships: ["brother of Aaron"] },
      { name: "Aaron", visualDescription: AARON_LOOK, role: "mentor", relationships: ["brother of Moses"] },
    ],
    factions: [
      { name: "Israelites", visualMarkers: "rough wool tunics in earth tones", alignment: "protagonist" },
    ],
    locations: [
      { name: "Pharaoh's palace", visualDescription: "sandstone columns painted with hieroglyphs, torchlight" },
    ],
    keyObjects: [
      { name: "the staff", visualDescription: "gnarled acacia wood, shoulder height", significance: "instrument of the signs" },
    ],
    chronology: [
      "Page 1: Moses confronts Pharaoh",
      "Page 2: The river turns to blood",
      "Page 3: The exodus begins",
      "The sea parts",
    ],
    visualMotifs: [
      { name: "burning bush", description: "a desert shrub in golden flame that never consumes the leaves" },
    ],
    relationships: ["Moses and Aaron are brothers"],
    tone: "epic and reverent",
    setting: "Ancient Egypt",
    timePeriod: "1300 BCE",
    artStyle: LOCKED_ART_STYLE,
    narrativeSummary: "Moses leads the Israelites out of Egypt.",
  };
}

// ── LLM routing mock ────────────────────────────────────────────────────────
type Msg = { role: string; content: string };
type LLMParams = {
  messages: Msg[];
  response_format?: { json_schema?: { name?: string } };
};

function llmReply(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] } as never;
}

/** Route the mocked LLM by json_schema name: "story_context" vs "image_prompt". */
function stubLLM(opts: { failBible?: boolean; failPromptCall?: number } = {}) {
  let promptCalls = 0;
  mLLM.mockImplementation(async (params) => {
    const p = params as unknown as LLMParams;
    if (p.response_format?.json_schema?.name === "story_context") {
      if (opts.failBible) throw new Error("bible LLM down");
      return llmReply(bible());
    }
    promptCalls++;
    if (opts.failPromptCall && promptCalls === opts.failPromptCall) {
      throw new Error("prompt LLM down");
    }
    return llmReply({ prompt: `LLM prompt #${promptCalls}`, style: "oil", mood: "epic" });
  });
}

function callsBySchema(name: string): LLMParams[] {
  return mLLM.mock.calls
    .map((c) => c[0] as unknown as LLMParams)
    .filter((p) => p.response_format?.json_schema?.name === name);
}

function systemPrompts(): string[] {
  return callsBySchema("image_prompt").map(
    (p) => p.messages.find((m) => m.role === "system")?.content ?? ""
  );
}

// ── Pipeline fixtures (page mode) ───────────────────────────────────────────
const PAGE_TEXTS = [
  "Moses stood before Pharaoh and demanded freedom for his people.",
  "The waters of the Nile ran red as blood before the royal court.",
  "At dawn the Israelites walked out of Egypt carrying unleavened bread.",
];

beforeEach(() => {
  vi.clearAllMocks();
  mExtractPages.mockResolvedValue({
    totalPages: PAGE_TEXTS.length,
    pages: PAGE_TEXTS.map((text, i) => ({ pageNumber: i + 1, text })),
  } as never);
  mThumb.mockResolvedValue(Buffer.from("thumb") as never);
  mStoragePut.mockResolvedValue({ url: "https://cdn/thumb.png" } as never);
  mGenImage.mockImplementation(
    async (opts) =>
      ({ url: "https://cdn/g.png", key: `${opts.keyPrefix}.png` } as never)
  );
  mGetBookPages.mockResolvedValue([] as never);
  mCreatePage.mockImplementation(async (pg) => ({ id: 1, ...pg } as never));
  mUpdateBook.mockResolvedValue(undefined as never);
});

// ═══════════════════════════════════════════════════════════════════════════
describe("story-bible consistency across a book (page-mode pipeline)", () => {
  it("builds the visual bible exactly once per book and prompts once per page", async () => {
    stubLLM();

    const result = await processBookPipeline(1, Buffer.from("pdf"));

    expect(result).toEqual({ successCount: 3, failureCount: 0 });
    expect(callsBySchema("story_context")).toHaveLength(1);
    expect(callsBySchema("image_prompt")).toHaveLength(3);
  });

  it("carries the locked art style and exact character/location/motif descriptions into EVERY page prompt — no drift", async () => {
    stubLLM();

    await processBookPipeline(1, Buffer.from("pdf"));

    const sys = systemPrompts();
    expect(sys).toHaveLength(3);
    for (const s of sys) {
      expect(s).toContain(LOCKED_ART_STYLE);
      expect(s).toContain(MOSES_LOOK);
      expect(s).toContain(AARON_LOOK);
      expect(s).toContain("sandstone columns painted with hieroglyphs");
      expect(s).toContain("a desert shrub in golden flame that never consumes the leaves");
      expect(s).toContain("rough wool tunics in earth tones");
    }
    // Drift check: the bible block (everything from ART STYLE up to the
    // page-specific chronology/rules) must be byte-identical on every page.
    const bibleBlock = (s: string) => s.slice(s.indexOf("ART STYLE"), s.indexOf("RELATIONSHIPS"));
    expect(new Set(sys.map(bibleBlock)).size).toBe(1);
  });

  it("gates the chronology per page — a page never sees future events", async () => {
    stubLLM();

    await processBookPipeline(1, Buffer.from("pdf"));

    const sys = systemPrompts();
    // Page 1: no numbered events have happened yet; un-numbered entries always pass.
    expect(sys[0]).not.toContain("Page 1: Moses confronts Pharaoh");
    expect(sys[0]).toContain("The sea parts");
    // Page 2 sees page-1 events only.
    expect(sys[1]).toContain("Page 1: Moses confronts Pharaoh");
    expect(sys[1]).not.toContain("Page 2: The river turns to blood");
    expect(sys[1]).not.toContain("Page 3: The exodus begins");
    // Page 3 sees pages 1-2, never its own or later events.
    expect(sys[2]).toContain("Page 1: Moses confronts Pharaoh");
    expect(sys[2]).toContain("Page 2: The river turns to blood");
    expect(sys[2]).not.toContain("Page 3: The exodus begins");
  });

  it("completes the whole book without a bible when the bible build fails", async () => {
    stubLLM({ failBible: true });

    const result = await processBookPipeline(1, Buffer.from("pdf"));

    expect(result).toEqual({ successCount: 3, failureCount: 0 });
    for (const s of systemPrompts()) {
      expect(s).not.toContain("VISUAL BIBLE");
      expect(s).toContain("Maintain visual consistency");
    }
    expect(mUpdateBook).toHaveBeenLastCalledWith(1, { processingStatus: "completed" });
  });

  it("refuses to render a blank/no-text page as generic placeholder art — fails that page, permanently, without blocking the rest of the book", async () => {
    stubLLM();
    // Page 2 has no text layer at all (e.g. a scanned image page).
    mExtractPages.mockResolvedValue({
      totalPages: 3,
      pages: [
        { pageNumber: 1, text: PAGE_TEXTS[0] },
        { pageNumber: 2, text: "" },
        { pageNumber: 3, text: PAGE_TEXTS[2] },
      ],
    } as never);

    const result = await processBookPipeline(1, Buffer.from("pdf"));

    // The other two pages still succeed; only the blank page fails.
    expect(result).toEqual({ successCount: 2, failureCount: 1 });
    // No image was ever generated for the blank page — no generic art rendered.
    expect(mGenImage).toHaveBeenCalledTimes(2);
    // The failed page is recorded as an error...
    expect(mCreatePage).toHaveBeenCalledWith(
      expect.objectContaining({ pageNumber: 2, processingStatus: "error" })
    );
    // ...but NOT scheduled for automatic retry: the text will still be absent
    // on retry, so retrying can't fix it (unlike a transient image-gen failure).
    expect(mRetryPage).not.toHaveBeenCalled();
    // Book still completes overall since 2 of 3 pages succeeded.
    expect(mUpdateBook).toHaveBeenLastCalledWith(1, { processingStatus: "completed" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("transcribe/render phase boundary (decoupling invariant)", () => {
  it("the image generator only ever receives the mediated prompt + render params — never raw page text", async () => {
    stubLLM();

    await processBookPipeline(1, Buffer.from("pdf"));

    expect(mGenImage).toHaveBeenCalledTimes(3);
    mGenImage.mock.calls.forEach((call, i) => {
      const args = call[0] as Record<string, unknown>;
      // Exact argument surface: prompt, storage prefix, render params. Nothing else.
      expect(Object.keys(args).sort()).toEqual(["keyPrefix", "params", "prompt"]);
      // The prompt is the LLM-mediated one, not transcription output.
      expect(args.prompt).toBe(`LLM prompt #${i + 1}`);
      // No raw page text anywhere in the render-side arguments.
      const flat = JSON.stringify(args);
      for (const raw of PAGE_TEXTS) expect(flat).not.toContain(raw);
    });
    // Batch page-mode reads text via pdfService extraction; the per-image OCR
    // service is never consulted on this path.
    expect(mOcr).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("promptService unit behaviour (bible construction + per-page prompting)", () => {
  it("buildStoryContext returns null without calling the LLM when no page has meaningful text", async () => {
    stubLLM();

    const ctx = await buildStoryContext(["", "   ", "short"]);

    expect(ctx).toBeNull();
    expect(mLLM).not.toHaveBeenCalled();
  });

  it("buildStoryContext degrades to null (no throw) when the LLM call fails", async () => {
    stubLLM({ failBible: true });

    const ctx = await buildStoryContext(["a page with plenty of meaningful text on it"]);

    expect(ctx).toBeNull();
  });

  it("refuses to render an empty page — throws EmptyPageError instead of generic placeholder art, no LLM call", async () => {
    stubLLM();

    await expect(generateImagePrompt("", 5, undefined, bible())).rejects.toThrow(EmptyPageError);
    await expect(generateImagePrompt("   ", 5, undefined, bible())).rejects.toThrow(/no extractable text/);
    expect(mLLM).not.toHaveBeenCalled();
  });

  it("surfaces per-page prompt failure as a thrown error (callers own retry policy)", async () => {
    mLLM.mockRejectedValue(new Error("prompt LLM down") as never);

    await expect(
      generateImagePrompt("some meaningful page text", 1, undefined, bible())
    ).rejects.toThrow(/Prompt generation failed/);
  });

  it("generateImagePromptsWithContext builds one bible and falls back per page on individual failure", async () => {
    stubLLM({ failPromptCall: 2 });

    const prompts = await generateImagePromptsWithContext([
      "page one meaningful text for the bible to read",
      "page two meaningful text for the bible to read",
    ]);

    expect(callsBySchema("story_context")).toHaveLength(1);
    expect(prompts).toHaveLength(2);
    expect(prompts[0].prompt).toBe("LLM prompt #1");
    // Failed page degrades to the neutral fallback; it does not poison the batch.
    expect(prompts[1]).toEqual({ prompt: "A page from a book", style: "illustration", mood: "neutral" });
  });
});
