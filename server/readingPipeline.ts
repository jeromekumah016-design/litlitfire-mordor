/**
 * Multi-pass book reading (genre → intent/plot → prompts)
 * Pass 1: discover genres the book conveys (open-ended).
 * Pass 2: author intent + main vs skip roles; visual bible.
 * Pass 3: ONE prompt per page number for MAIN pages (no multi-page collapse).
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

/**
 * Product rule: one illustration decision per page number.
 * Expands any multi-page LLM ranges into per-page units, sorted by pageNumber.
 */
export function normalizeUnitsByPageNumber(
  pageCount: number,
  raw: PlotUnit[],
  pageTexts?: string[]
): PlotUnit[] {
  const roleByPage = new Map<number, { role: PlotUnit["role"]; title: string; rationale: string }>();
  for (const u of raw) {
    const from = Math.max(1, Math.floor(Number(u.sourcePageFrom) || 1));
    const to = Math.max(from, Math.floor(Number(u.sourcePageTo) || from));
    const role = (u.role === "main" || u.role === "side" ? u.role : "skip") as PlotUnit["role"];
    for (let p = from; p <= to && p <= pageCount; p++) {
      // Prefer main if any covering unit marks main; otherwise keep first label.
      const prev = roleByPage.get(p);
      if (!prev || (role === "main" && prev.role !== "main")) {
        roleByPage.set(p, {
          role,
          title: from === to ? String(u.title || `Page ${p}`) : `Page ${p}`,
          rationale: String(u.rationale || ""),
        });
      }
    }
  }

  const units: PlotUnit[] = [];
  for (let p = 1; p <= pageCount; p++) {
    const hit = roleByPage.get(p);
    if (hit) {
      units.push({
        unitIndex: p - 1,
        sourcePageFrom: p,
        sourcePageTo: p,
        role: hit.role,
        title: hit.title || `Page ${p}`,
        rationale: hit.rationale,
      });
      continue;
    }
    const text = pageTexts?.[p - 1] || "";
    const main = text.trim().length > 40;
    units.push({
      unitIndex: p - 1,
      sourcePageFrom: p,
      sourcePageTo: p,
      role: main ? "main" : "skip",
      title: main ? `Page ${p}` : `Skip ${p}`,
      rationale: main
        ? "Default: enough text for page-number illustration"
        : "Default: sparse/non-plot page",
    });
  }
  return units;
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
Decide MAIN vs SKIP for EACH page number (one decision per page).
- role "main" = illustrate this page (one image for that page number)
- role "skip" = do not illustrate (front matter, blank, index, non-plot)
sourcePageFrom and sourcePageTo MUST be the same page number (no multi-page units).
Cover every page that appears in the scan.`,
        },
        {
          role: "user",
          content: `Map one illustration decision per page number:\n\n${scan}`,
        },
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
      title: String(u.title || `Page ${u.sourcePageFrom || i + 1}`),
      rationale: String(u.rationale || ""),
    }));
    return {
      authorIntent: parsed.authorIntent || "Illustrate the core narrative.",
      plotUnits: normalizeUnitsByPageNumber(
        pageTexts.length,
        units.length > 0 ? units : fallbackUnits(pageTexts),
        pageTexts
      ),
    };
  } catch (e) {
    console.warn("[Reading] plot map failed, using heuristic:", e);
    return {
      authorIntent: "Illustrate the core narrative moments.",
      plotUnits: normalizeUnitsByPageNumber(
        pageTexts.length,
        fallbackUnits(pageTexts),
        pageTexts
      ),
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

  // Always process in ascending page number order (DB already orders; re-sort for safety).
  const pagesByNumber = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const pageTextsOrdered = pagesByNumber.map((p) => p.ocrText || "");
  const byNumber = new Map(pagesByNumber.map((p) => [p.pageNumber, p]));

  const genres = await discoverGenres(pageTextsOrdered);
  const { authorIntent, plotUnits: rawUnits } = await mapPlotAndIntent(
    pageTextsOrdered,
    genres
  );
  const plotUnits = normalizeUnitsByPageNumber(
    pagesByNumber.length > 0
      ? Math.max(...pagesByNumber.map((p) => p.pageNumber))
      : pageTextsOrdered.length,
    rawUnits,
    // Align heuristic fallbacks to absolute page numbers when sparse.
    pagesByNumber.reduce<string[]>((acc, p) => {
      acc[p.pageNumber - 1] = p.ocrText || "";
      return acc;
    }, [])
  );
  const bible: StoryContext | null = await buildStoryContext(pageTextsOrdered);
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
  // Strict page-number order for prompt generation
  const mainUnits = plotUnits
    .filter((u) => u.role === "main")
    .sort((a, b) => a.sourcePageFrom - b.sourcePageFrom);

  const mainPageNumbers = new Set(mainUnits.map((u) => u.sourcePageFrom));

  for (const page of pagesByNumber) {
    if (mainPageNumbers.has(page.pageNumber)) continue;
    if (page.promptStatus === "approved" || page.imageStatus === "image_ready") continue;
    await updatePage(page.id, {
      skipSuggested: true,
      promptStatus: "prompt_error",
      errorMessage: "Skipped: non-plot / non-canon / front matter (page-number pass)",
    });
    skippedPages++;
  }

  const pageContexts: { pageNumber: number; text: string; prompt: string; setting?: string }[] =
    [];

  for (const unit of mainUnits) {
    const pageNum = unit.sourcePageFrom; // === sourcePageTo after normalize
    const pageRow = byNumber.get(pageNum);
    if (!pageRow) continue;
    if (pageRow.promptStatus === "approved" || pageRow.promptStatus === "prompt_ready") {
      if (pageRow.generatedPrompt) {
        pageContexts.push({
          pageNumber: pageRow.pageNumber,
          text: pageRow.ocrText || "",
          prompt: pageRow.generatedPrompt,
        });
      }
      promptsReady++;
      continue;
    }

    const unitText = pageRow.ocrText || "";

    await updatePage(pageRow.id, { promptStatus: "transcribing", skipSuggested: false });
    try {
      const genreNote = genres.length ? ` Genre context: ${genres.join(", ")}.` : "";
      const intentNote = authorIntent ? ` Authorial intent: ${authorIntent}` : "";
      const enrichedText = `${unitText}\n\n[Illustration for page ${pageNum}: ${unit.title}.${genreNote}${intentNote}]`;

      const result = await generateImagePrompt(
        enrichedText,
        pageNum,
        pageContexts.length ? pageContexts : undefined,
        bible
      );

      await updatePage(pageRow.id, {
        promptStatus: "prompt_ready",
        generatedPrompt: result.prompt,
        promptStructured: {
          style: result.style ?? null,
          mood: result.mood ?? null,
          unitIndex: unit.unitIndex,
          pageNumber: pageNum,
          sourcePages: [pageNum, pageNum],
          unitTitle: unit.title,
          unitRationale: unit.rationale,
          genres,
        } as any,
        errorMessage: null,
        skipSuggested: false,
      });

      pageContexts.push({
        pageNumber: pageRow.pageNumber,
        text: unitText,
        prompt: result.prompt,
        setting: result.mood,
      });
      promptsReady++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await updatePage(pageRow.id, {
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
