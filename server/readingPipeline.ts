/**
 * Multi-pass book reading (genre → chapters → prompts)
 * Pass 1: discover genres.
 * Pass 1b: chapter detect from page breaks + headings (lite package).
 * Pass 2: author intent + visual bible.
 * Pass 3: ONE prompt per MAIN chapter (anchor page) — lite only.
 *
 * Upgraded (one image per page) is paid package framing only; not selected by upload.
 */

import { invokeLLM } from "./_core/llm";
import {
  buildStoryContext,
  generateImagePrompt,
  EmptyPageError,
  type StoryContext,
} from "./promptService";
import { getBook, getBookPages, updateBook, updatePage } from "./db";
import {
  detectChaptersFromPageBreaks,
  unitsFromChapters,
  type Chapter,
} from "./chapterDetect";

export type PlotUnit = {
  unitIndex: number;
  sourcePageFrom: number;
  sourcePageTo: number;
  role: "main" | "side" | "skip";
  title: string;
  rationale: string;
  chapterIndex?: number;
};

export type ReadingProfile = {
  genres: string[];
  authorIntent: string;
  packageTier: "lite" | "upgraded";
  chapters: Chapter[];
  plotUnits: PlotUnit[];
  passCompletedAt: string;
};

export type MultiPassResult = {
  bookId: number;
  genres: string[];
  packageTier: "lite" | "upgraded";
  chapterCount: number;
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

/** Author intent only — chapter structure comes from detectChaptersFromPageBreaks. */
export async function mapAuthorIntent(
  pageTexts: string[],
  genres: string[],
  chapters: Chapter[]
): Promise<string> {
  const scan = scanText(pageTexts);
  const chapterList = chapters
    .map(
      (c) =>
        `${c.chapterIndex + 1}. "${c.title}" pages ${c.sourcePageFrom}–${c.sourcePageTo} (${c.role})`
    )
    .join("\n");
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a story editor preparing a lite illustrated edition (one image per chapter).
Genres: ${genres.join(", ")}.
Summarize authorial intent in 1–3 sentences for illustration direction.
Known chapters:\n${chapterList}`,
        },
        { role: "user", content: `Authorial intent for this book:\n\n${scan}` },
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
    if (!raw) return "Illustrate the core narrative through chapter moments.";
    const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw)) as {
      authorIntent?: string;
    };
    return parsed.authorIntent || "Illustrate the core narrative through chapter moments.";
  } catch (e) {
    console.warn("[Reading] author intent failed:", e);
    return "Illustrate the core narrative through chapter moments.";
  }
}

/**
 * Future paid package only — not used by upload this pass.
 * Kept for a later paid unlock; do not wire to public routers.
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
        ? "Upgraded package: page-number illustration"
        : "Upgraded package: sparse page",
    });
  }
  return units;
}

export async function runMultiPassReading(bookId: number): Promise<MultiPassResult> {
  const book = await getBook(bookId);
  if (!book) throw new Error(`Book ${bookId} not found`);
  const pages = await getBookPages(bookId);
  if (pages.length === 0) {
    throw new Error("No pages extracted — cannot run multi-pass reading");
  }

  // Product rule: always lite until paid upgrade ships (ignore any upgraded value).
  const packageTier: "lite" = "lite";
  await updateBook(bookId, {
    processingStatus: "processing",
    packageTier: "lite",
  } as any);

  const pagesByNumber = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const pageTextsOrdered = pagesByNumber.map((p) => p.ocrText || "");
  const byNumber = new Map(pagesByNumber.map((p) => [p.pageNumber, p]));

  // Align text array index 0 → page 1 when page numbers are contiguous 1..n
  const maxPage =
    pagesByNumber.length > 0
      ? Math.max(...pagesByNumber.map((p) => p.pageNumber))
      : pageTextsOrdered.length;
  const textsByPageIndex: string[] = Array.from({ length: maxPage }, (_, i) => {
    const row = byNumber.get(i + 1);
    return row?.ocrText || "";
  });

  const genres = await discoverGenres(pageTextsOrdered);
  const chapters = detectChaptersFromPageBreaks(textsByPageIndex);
  const authorIntent = await mapAuthorIntent(pageTextsOrdered, genres, chapters);
  const plotUnits: PlotUnit[] = unitsFromChapters(chapters);

  const bible: StoryContext | null = await buildStoryContext(pageTextsOrdered);
  if (bible) {
    await updateBook(bookId, { storyBible: bible as any });
  }

  const profile: ReadingProfile = {
    genres,
    authorIntent,
    packageTier,
    chapters,
    plotUnits,
    passCompletedAt: new Date().toISOString(),
  };
  await updateBook(bookId, { readingProfile: profile as any, packageTier: "lite" } as any);

  let promptsReady = 0;
  let errors = 0;
  let skippedPages = 0;

  const mainUnits = plotUnits
    .filter((u) => u.role === "main")
    .sort((a, b) => a.sourcePageFrom - b.sourcePageFrom);

  // Pages covered by any main chapter (full range)
  const mainCovered = new Set<number>();
  const anchorPages = new Set<number>();
  for (const u of mainUnits) {
    anchorPages.add(u.sourcePageFrom);
    for (let p = u.sourcePageFrom; p <= u.sourcePageTo; p++) mainCovered.add(p);
  }

  for (const page of pagesByNumber) {
    if (anchorPages.has(page.pageNumber)) continue;
    if (page.promptStatus === "approved" || page.imageStatus === "image_ready") continue;

    if (mainCovered.has(page.pageNumber)) {
      const unit = mainUnits.find(
        (u) => page.pageNumber >= u.sourcePageFrom && page.pageNumber <= u.sourcePageTo
      );
      await updatePage(page.id, {
        skipSuggested: true,
        promptStatus: "prompt_error",
        errorMessage: unit
          ? `Covered by chapter "${unit.title}" (lite package — pages ${unit.sourcePageFrom}–${unit.sourcePageTo})`
          : "Covered by chapter (lite package)",
      });
    } else {
      await updatePage(page.id, {
        skipSuggested: true,
        promptStatus: "prompt_error",
        errorMessage: "Skipped: non-plot / front matter (lite chapter pass)",
      });
    }
    skippedPages++;
  }

  const pageContexts: { pageNumber: number; text: string; prompt: string; setting?: string }[] =
    [];

  for (const unit of mainUnits) {
    const anchorNum = unit.sourcePageFrom;
    const pageRow = byNumber.get(anchorNum);
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

    // Combine text across chapter page range for a richer chapter prompt
    const parts: string[] = [];
    for (let p = unit.sourcePageFrom; p <= unit.sourcePageTo; p++) {
      const t = byNumber.get(p)?.ocrText;
      if (t?.trim()) parts.push(t.trim());
    }
    const unitText = parts.join("\n\n") || pageRow.ocrText || "";

    await updatePage(pageRow.id, { promptStatus: "transcribing", skipSuggested: false });
    try {
      const genreNote = genres.length ? ` Genre context: ${genres.join(", ")}.` : "";
      const intentNote = authorIntent ? ` Authorial intent: ${authorIntent}` : "";
      const enrichedText = `${unitText}\n\n[Lite package — Chapter illustration: "${unit.title}". Pages ${unit.sourcePageFrom}–${unit.sourcePageTo}.${genreNote}${intentNote}]`;

      const result = await generateImagePrompt(
        enrichedText,
        anchorNum,
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
          chapterIndex: unit.chapterIndex ?? unit.unitIndex,
          chapterTitle: unit.title,
          pageNumber: anchorNum,
          sourcePages: [unit.sourcePageFrom, unit.sourcePageTo],
          unitTitle: unit.title,
          unitRationale: unit.rationale,
          packageTier: "lite",
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
    packageTier,
    chapterCount: chapters.length,
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
      label: `Ready to generate (${approvedCount} chapter${approvedCount === 1 ? "" : "s"} approved)`,
      promptReadyCount,
      approvedCount,
      imageReadyCount,
      pageRowCount,
    };
  }
  if (promptReadyCount > 0) {
    return {
      phase: "needs_approve",
      label: `Approve chapters (${promptReadyCount} ready)`,
      promptReadyCount,
      approvedCount,
      imageReadyCount,
      pageRowCount,
    };
  }
  if (bookStatus === "processing") {
    return {
      phase: "reading",
      label: "Reading book (genre → chapters → prompts)…",
      promptReadyCount,
      approvedCount,
      imageReadyCount,
      pageRowCount,
    };
  }
  const hasOcr = pages.some((p) => (p.ocrText || "").trim().length > 0);
  return {
    phase: "extracted",
    label: hasOcr ? "Next: build chapter prompts (Stage 1)" : "Extracting text…",
    promptReadyCount,
    approvedCount,
    imageReadyCount,
    pageRowCount,
  };
}
