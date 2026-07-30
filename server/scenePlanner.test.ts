import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest). The scene planner depends on the LLM
// helper and on generateImagePrompt; both are stubbed so tests are hermetic.
// ---------------------------------------------------------------------------
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

vi.mock("./promptService", () => ({
  generateImagePrompt: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";
import { generateImagePrompt } from "./promptService";
import {
  clampSceneCount,
  dedupeScenes,
  rankAndCapScenes,
  buildFallbackScenes,
  selectScenes,
  generateScenePrompts,
  DEFAULT_MAX_SCENES,
  type Scene,
} from "./scenePlanner";

const mockedInvokeLLM = vi.mocked(invokeLLM);
const mockedGeneratePrompt = vi.mocked(generateImagePrompt);

function llmReturning(scenes: unknown) {
  return {
    id: "x",
    created: 0,
    model: "test",
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: JSON.stringify({ scenes }) },
        finish_reason: "stop",
      },
    ],
  };
}

function scene(partial: Partial<Scene>): Scene {
  return {
    sourcePage: 1,
    title: "t",
    description: "d",
    rationale: "r",
    importance: 3,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe("clampSceneCount", () => {
  it("clamps to available pages when requested exceeds them", () => {
    expect(clampSceneCount(50, 4)).toBe(4);
  });

  it("honours an explicit maxScenes ceiling", () => {
    expect(clampSceneCount(50, 100, { maxScenes: 6 })).toBe(6);
  });

  it("raises to minScenes floor when requested is below it", () => {
    expect(clampSceneCount(0, 10, { minScenes: 3 })).toBe(3);
  });

  it("never returns more than available even with a high floor", () => {
    expect(clampSceneCount(0, 2, { minScenes: 9 })).toBe(2);
  });

  it("returns 0 when nothing is available", () => {
    expect(clampSceneCount(5, 0)).toBe(0);
  });

  it("defaults to DEFAULT_MAX_SCENES ceiling", () => {
    expect(clampSceneCount(999, 999)).toBe(DEFAULT_MAX_SCENES);
  });
});

describe("dedupeScenes", () => {
  it("removes same page + same title", () => {
    const out = dedupeScenes([
      scene({ sourcePage: 1, title: "The storm", description: "a" }),
      scene({ sourcePage: 1, title: "the STORM!", description: "b" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("removes identical descriptions even across pages", () => {
    const out = dedupeScenes([
      scene({ sourcePage: 1, title: "x", description: "A ship at sea." }),
      scene({ sourcePage: 2, title: "y", description: "a ship at sea" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps genuinely distinct scenes", () => {
    const out = dedupeScenes([
      scene({ sourcePage: 1, title: "x", description: "A ship." }),
      scene({ sourcePage: 2, title: "y", description: "A castle." }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("preserves first-occurrence order", () => {
    const out = dedupeScenes([
      scene({ sourcePage: 3, title: "c", description: "c" }),
      scene({ sourcePage: 1, title: "a", description: "a" }),
    ]);
    expect(out.map((s) => s.title)).toEqual(["c", "a"]);
  });
});

describe("rankAndCapScenes", () => {
  it("keeps the highest-importance scenes but returns them in reading order", () => {
    const out = rankAndCapScenes(
      [
        scene({ sourcePage: 1, title: "low", importance: 1 }),
        scene({ sourcePage: 2, title: "high", importance: 5 }),
        scene({ sourcePage: 3, title: "mid", importance: 3 }),
      ],
      2
    );
    // top-2 by importance = pages 2 and 3, returned page-ascending
    expect(out.map((s) => s.sourcePage)).toEqual([2, 3]);
  });

  it("returns empty for a non-positive limit", () => {
    expect(rankAndCapScenes([scene({})], 0)).toEqual([]);
  });
});

describe("buildFallbackScenes", () => {
  it("creates one scene per meaningful page and skips sparse pages", () => {
    const out = buildFallbackScenes([
      "This is a long enough page to be meaningful for illustration.",
      "  ", // blank
      "Another sufficiently long page describing a vivid scene here.",
    ]);
    expect(out.map((s) => s.sourcePage)).toEqual([1, 3]);
  });

  it("respects the maxScenes cap", () => {
    const pages = Array.from({ length: 5 }, () => "A nice long meaningful page of text.");
    expect(buildFallbackScenes(pages, { maxScenes: 2 })).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
describe("selectScenes", () => {
  it("returns [] with no meaningful text and never calls the LLM", async () => {
    const out = await selectScenes(["", "   "]);
    expect(out).toEqual([]);
    expect(mockedInvokeLLM).not.toHaveBeenCalled();
  });

  it("parses, dedupes and caps LLM scenes", async () => {
    mockedInvokeLLM.mockResolvedValue(
      llmReturning([
        { sourcePage: 1, title: "Storm", description: "A storm at sea.", rationale: "pivotal", importance: 5 },
        { sourcePage: 1, title: "storm!", description: "A storm at sea (dup).", rationale: "dup", importance: 4 },
        { sourcePage: 2, title: "Calm", description: "A calm harbour.", rationale: "nice", importance: 2 },
      ]) as any
    );
    const out = await selectScenes(
      [
        "A long meaningful page describing a violent storm at sea.",
        "A long meaningful page describing a calm harbour at dawn.",
      ],
      null,
      { maxScenes: 5 }
    );
    expect(out).toHaveLength(2); // the page-1 duplicate is dropped
    expect(out.map((s) => s.sourcePage)).toEqual([1, 2]); // reading order
  });

  it("clamps importance and page numbers from the LLM", async () => {
    mockedInvokeLLM.mockResolvedValue(
      llmReturning([
        { sourcePage: 99, title: "X", description: "Out of range page.", rationale: "", importance: 17 },
      ]) as any
    );
    const out = await selectScenes(["Only one meaningful page exists in this book."]);
    expect(out[0].sourcePage).toBe(1); // clamped to page count
    expect(out[0].importance).toBe(5); // clamped to max
  });

  it("falls back to one-scene-per-page when the LLM throws", async () => {
    mockedInvokeLLM.mockRejectedValue(new Error("LLM down"));
    const out = await selectScenes([
      "A long meaningful page one with plenty of descriptive text here.",
      "A long meaningful page two with plenty of descriptive text here.",
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].rationale).toMatch(/fallback/i);
  });

  it("falls back when the LLM returns an empty scene list", async () => {
    mockedInvokeLLM.mockResolvedValue(llmReturning([]) as any);
    const out = await selectScenes(["A long meaningful page worth illustrating here."]);
    expect(out).toHaveLength(1);
    expect(out[0].rationale).toMatch(/fallback/i);
  });

  it("enforces the maxScenes ceiling on LLM output", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      sourcePage: i + 1,
      title: `S${i}`,
      description: `Distinct scene number ${i} with unique content.`,
      rationale: "",
      importance: 3,
    }));
    mockedInvokeLLM.mockResolvedValue(llmReturning(many) as any);
    const pages = Array.from({ length: 8 }, (_, i) => `Meaningful page ${i} with enough text to illustrate.`);
    const out = await selectScenes(pages, null, { maxScenes: 3 });
    expect(out).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
describe("generateScenePrompts", () => {
  it("produces one prompt per selected scene, paired with its scene", async () => {
    mockedInvokeLLM.mockResolvedValue(
      llmReturning([
        { sourcePage: 1, title: "Storm", description: "A storm at sea.", rationale: "", importance: 5 },
        { sourcePage: 2, title: "Calm", description: "A calm harbour.", rationale: "", importance: 3 },
      ]) as any
    );
    mockedGeneratePrompt.mockImplementation(async (text) => ({
      prompt: `PROMPT(${text})`,
      style: "oil",
      mood: "x",
    }));

    const out = await generateScenePrompts(
      [
        "A long meaningful page describing a violent storm at sea here.",
        "A long meaningful page describing a calm harbour at dawn here.",
      ],
      null
    );
    expect(out).toHaveLength(2);
    expect(out[0].scene.title).toBe("Storm");
    expect(out[0].prompt).toContain("A storm at sea.");
    expect(mockedGeneratePrompt).toHaveBeenCalledTimes(2);
  });

  it("falls back to the scene description when prompt generation fails", async () => {
    mockedInvokeLLM.mockResolvedValue(
      llmReturning([
        { sourcePage: 1, title: "Storm", description: "A storm at sea.", rationale: "", importance: 5 },
      ]) as any
    );
    mockedGeneratePrompt.mockRejectedValue(new Error("prompt boom"));

    const out = await generateScenePrompts(
      ["A long meaningful page describing a violent storm at sea here."],
      null
    );
    expect(out).toHaveLength(1);
    expect(out[0].prompt).toContain("A storm at sea.");
    expect(out[0].scene.sourcePage).toBe(1);
  });

  it("returns [] when there is nothing meaningful to illustrate", async () => {
    const out = await generateScenePrompts(["", "  "], null);
    expect(out).toEqual([]);
    expect(mockedGeneratePrompt).not.toHaveBeenCalled();
  });
});
