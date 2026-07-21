/**
 * Multi-pass book reading (genre → intent/plot → prompts)
 * Pass 1: discover genres the book conveys (open-ended).
 * Pass 2: author intent + plot units (main vs skip); visual bible.
 * Pass 3: one prompt per MAIN unit (may span multiple pages) on start page.
 */

import { invokeLLM } from "./_core/llm";
import {
  buildStoryContext,
  generateImagePrompt,
  EmptyPageError,
  type StoryContext,
} from "./promptService";
import { getBook, getBookPages, updateBook, updatePage } from "./db";

export type PlotUnit = {
  unitIndex: number;
  sourcePageFrom: number;
  sourcePageTo: number;
  role: "main" | "side" | "skip";
  title: string;
  rationale: string;
};

export type ReadingProfile = {
  genres: string[];
  authorIntent: string;
  plotUnits: PlotUnit[];
  passCompletedAt: string;
};

export type MultiPassResult = {
  bookId: number;
  genres: string[];
  mainUnits: number;
  skippedPages: number;
  promptsReady: number;
  errors: number;
  biblePersisted: boolean;
};

function scanText(pageTexts: string[]): string {
  return pageTexts
    .map((t, i) => `--- Page ${i + 1} ---\n${(t || "").substring(0, 400)}`)
    .join("\n\n");
}

export async function discoverGenres(pageTexts: string[]): Promise<string[]> {
  const scan = scanText(pageTexts);
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You classify literary works by the genres they convey (open-ended labels).
Return JSON only. List 1–5 genre strings (e.g. "adventure fiction", "memoir", "sacred narrative").`,
        },
        { role: "user", content: `Identify genres for this book:\n\n${scan}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "book_genres",
          strict: true,
          schema: {
            type: "object",
            properties: {
              genres: { type: "array", items: { type: "string" } },
              confidence: { type: "string" },
              notes: { type: "string" },
            },
            required: ["genres"],
            additionalProperties: false,
          },
        },
      },
    });
    const raw = response.choices[0]?.message?.content;
    if (!raw) return ["literary narrative"];
    const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw)) as {
      genres?: string[];
    };
    const genres = (parsed.genres || []).map((g) => String(g).trim()).filter(Boolean);
    return genres.length > 0 ? genres.slice(0, 5) : ["literary narrative"];
  } catch (e) {
    console.warn("[Reading] genre discovery failed:", e);
    return ["literary narrative"];
  }
}

function fallbackUnits(pageTexts: string[]): PlotUnit[] {
  return pageTexts.map((t, i) => {
    const main = (t || "").trim().length > 40;
    return {
      unitIndex: i,
      sourcePageFrom: i + 1,
      sourcePageTo: i + 1,
      role: main ? ("main" as const) : ("skip" as const),
      title: main ? `Page ${i + 1}` : `Skip ${i + 1}`,
      rationale: main ? "Heuristic: enough text" : "Heuristic: too little text",
    };
  });
}

export async function mapPlotAndIntent(
  pageTexts: string[],
  genres: string[]
): Promise<{ authorIntent: string; plotUnits: PlotUnit[] }> {
  const scan = scanText(pageTexts);
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a story editor preparing an illustrated edition.
Genres: ${genres.join(", ")}.
Separate MAIN plot beats from non-plot material (front matter, index, digression, blank).
A plot unit may span MULTIPLE consecutive pages so the illustrated story is not longer than needed.
role must be "main" (illustrate) or "skip" (do not illustrate).`,
        },
        { role: "user", content: `Map plot units for illustration:\n\n${scan}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "plot_map",
          strict: true,
          schema: {
            type: "object",
            properties: {
              authorIntent: { type: "string" },
              plotUnits: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    unitIndex: { type: "number" },
                    sourcePageFrom: { type: "number" },
                    sourcePageTo: { type: "number" },
                    role: { type: "string" },
                    title: { type: "string" },
                    rationale: { type: "string" },
                  },
                  required: [
                    "unitIndex",
                    "sourcePageFrom",
                    "sourcePageTo",
                    "role",
                    "title",
                    "rationale",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["authorIntent", "plotUnits"],
            additionalProperties: false,
          },
        },
      },
    });
    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("empty plot_map");
    const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw)) as {
      authorIntent?: string;
      plotUnits?: PlotUnit[];
    };
    const units = (parsed.plotUnits || []).map((u, i) => ({
      unitIndex: u.unitIndex ?? i,
      sourcePageFrom: Math.max(1, Math.floor(Number(u.sourcePageFrom) || 1)),
      sourcePageTo: Math.max(
        Math.floor(Number(u.sourcePageFrom) || 1),
        Math.floor(Number(u.sourcePageTo) || Number(u.sourcePageFrom) || 1)
      ),
      role: (u.role === "main" || u.role === "side" ? u.role : "skip") as PlotUnit["role"],
      title: String(u.title || `Unit ${i}`),
      rationale: String(u.rationale || ""),
    }));
    return {
      authorIntent: parsed.authorIntent || "Illustrate the core narrative.",
      plotUnits: units.length > 0 ? units : fallbackUnits(pageTexts),
    };
  } catch (e) {
    console.warn("[Reading] plot map failed, using heuristic:", e);
    return {
      authorIntent: "Illustrate the core narrative moments.",
      plotUnits: fallbackUnits(pageTexts),
    };
  }
}

export async function runMultiPassReading(bookId: number): Promise<MultiPassResult> {
  const book = await getBook(bookId);
  if (!book) throw new Error(`Book ${bookId} not found`);
  const pages = await getBookPages(bookId);
  if (pages.length === 0) {
    throw new Error("No pages extracted — cannot run multi-pass reading");
  }

  await updateBook(bookId, { processingStatus: "processing" } as any);

  const pageTexts = pages.map((p) => p.ocrText || "");
  const byNumber = new Map(pages.map((p) => [p.pageNumber, p]));

  const genres = await discoverGenres(pageTexts);
  const { authorIntent, plotUnits } = await mapPlotAndIntent(pageTexts, genres);
  const bible: StoryContext | null = await buildStoryContext(pageTexts);
  if (bible) {
    await updateBook(bookId, { storyBible: bible as any });
  }

  const profile: ReadingProfile = {
    genres,
    authorIntent,
    plotUnits,
    passCompletedAt: new Date().toISOString(),
  };
  await updateBook(bookId, { readingProfile: profile as any });

  let promptsReady = 0;
  let errors = 0;
  let skippedPages = 0;
  const mainUnits = plotUnits.filter((u) => u.role === "main");

  const mainCovered = new Set<number>();
  for (const u of mainUnits) {
    for (let p = u.sourcePageFrom; p <= u.sourcePageTo; p++) mainCovered.add(p);
  }

  for (const page of pages) {
    if (mainCovered.has(page.pageNumber)) continue;
    if (page.promptStatus === "approved" || page.imageStatus === "image_ready") continue;
    await updatePage(page.id, {
      skipSuggested: true,
      promptStatus: "prompt_error",
      errorMessage: "Skipped: non-plot / non-canon / front matter (multi-pass reading)",
    });
    skippedPages++;
  }

  const pageContexts: { pageNumber: number; text: string; prompt: string; setting?: string }[] =
    [];

  for (const unit of mainUnits) {
    const startPage = byNumber.get(unit.sourcePageFrom);
    if (!startPage) continue;
    if (startPage.promptStatus === "approved" || startPage.promptStatus === "prompt_ready") {
      if (startPage.generatedPrompt) {
        pageContexts.push({
          pageNumber: startPage.pageNumber,
          text: startPage.ocrText || "",
          prompt: startPage.generatedPrompt,
        });
      }
      promptsReady++;
      continue;
    }

    const combined: string[] = [];
    for (let p = unit.sourcePageFrom; p <= unit.sourcePageTo; p++) {
      const row = byNumber.get(p);
      if (row?.ocrText) combined.push(row.ocrText);
    }
    const unitText = combined.join("\n\n") || startPage.ocrText || "";

    await updatePage(startPage.id, { promptStatus: "transcribing", skipSuggested: false });
    try {
      const genreNote = genres.length ? ` Genre context: ${genres.join(", ")}.` : "";
      const intentNote = authorIntent ? ` Authorial intent: ${authorIntent}` : "";
      const enrichedText = `${unitText}\n\n[Illustration unit: ${unit.title}. Pages ${unit.sourcePageFrom}–${unit.sourcePageTo}.${genreNote}${intentNote}]`;

      const result = await generateImagePrompt(
        enrichedText,
        unit.sourcePageFrom,
        pageContexts.length ? pageContexts : undefined,
        bible
      );

      await updatePage(startPage.id, {
        promptStatus: "prompt_ready",
        generatedPrompt: result.prompt,
        promptStructured: {
          style: result.style ?? null,
          mood: result.mood ?? null,
          unitIndex: unit.unitIndex,
          sourcePages: [unit.sourcePageFrom, unit.sourcePageTo],
          unitTitle: unit.title,
          unitRationale: unit.rationale,
          genres,
        } as any,
        errorMessage: null,
        skipSuggested: false,
      });

      for (let p = unit.sourcePageFrom + 1; p <= unit.sourcePageTo; p++) {
        const mid = byNumber.get(p);
        if (!mid) continue;
        if (mid.promptStatus === "approved" || mid.imageStatus === "image_ready") continue;
        await updatePage(mid.id, {
          skipSuggested: true,
          promptStatus: "prompt_error",
          errorMessage: `Covered by plot unit starting at page ${unit.sourcePageFrom} ("${unit.title}")`,
        });
        skippedPages++;
      }

      pageContexts.push({
        pageNumber: startPage.pageNumber,
        text: unitText,
        prompt: result.prompt,
        setting: result.mood,
      });
      promptsReady++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await updatePage(startPage.id, {
        promptStatus: "prompt_error",
        errorMessage: msg,
        skipSuggested: e instanceof EmptyPageError,
      });
      errors++;
    }
  }

  await updateBook(bookId, { processingStatus: "pending" } as any);
  const fresh = await getBook(bookId);

  return {
    bookId,
    genres,
    mainUnits: mainUnits.length,
    skippedPages,
    promptsReady,
    errors,
    biblePersisted: !!(fresh as { storyBible?: unknown } | null)?.storyBible,
  };
}

export type PipelinePhase =
  | "extracted"
  | "reading"
  | "needs_approve"
  | "ready_to_render"
  | "photos_ready"
  | "failed";

export function derivePipelinePhase(
  bookStatus: string,
  pages: Array<{
    promptStatus?: string | null;
    imageStatus?: string | null;
    ocrText?: string | null;
    skipSuggested?: boolean | null;
  }>
): {
  phase: PipelinePhase;
  label: string;
  promptReadyCount: number;
  approvedCount: number;
  imageReadyCount: number;
  pageRowCount: number;
} {
  const pageRowCount = pages.length;
  const promptReadyCount = pages.filter(
    (p) => p.promptStatus === "prompt_ready" || p.promptStatus === "approved"
  ).length;
  const approvedCount = pages.filter((p) => p.promptStatus === "approved").length;
  const imageReadyCount = pages.filter((p) => p.imageStatus === "image_ready").length;

  if (bookStatus === "failed") {
    return {
      phase: "failed",
      label: "Failed",
      promptReadyCount,
      approvedCount,
      imageReadyCount,
      pageRowCount,
    };
  }
  if (pageRowCount === 0) {
    return {
      phase: "extracted",
      label: "Waiting for text extract",
      promptReadyCount,
      approvedCount,
      imageReadyCount,
      pageRowCount,
    };
  }
  if (imageReadyCount > 0 && approvedCount > 0 && imageReadyCount >= approvedCount) {
    return {
      phase: "photos_ready",
      label: "Photos ready",
      promptReadyCount,
      approvedCount,
      imageReadyCount,
      pageRowCount,
    };
  }
  if (approvedCount > 0) {
    return {
      phase: "ready_to_render",
      label: `Ready to generate (${approvedCount} approved)`,
      promptReadyCount,
      approvedCount,
      imageReadyCount,
      pageRowCount,
    };
  }
  if (promptReadyCount > 0) {
    return {
      phase: "needs_approve",
      label: `Approve prompts (${promptReadyCount} ready)`,
      promptReadyCount,
      approvedCount,
      imageReadyCount,
      pageRowCount,
    };
  }
  if (bookStatus === "processing") {
    return {
      phase: "reading",
      label: "Reading book (genre → plot → prompts)…",
      promptReadyCount,
      approvedCount,
      imageReadyCount,
      pageRowCount,
    };
  }
  const hasOcr = pages.some((p) => (p.ocrText || "").trim().length > 0);
  return {
    phase: "extracted",
    label: hasOcr ? "Next: build prompts (Stage 1)" : "Extracting text…",
    promptReadyCount,
    approvedCount,
    imageReadyCount,
    pageRowCount,
  };
}
