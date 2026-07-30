/**
 * Lite package: detect chapter boundaries from page breaks + headings.
 * Deterministic (no LLM). Used only for lite density (one image per chapter).
 */

export type Chapter = {
  chapterIndex: number;
  title: string;
  sourcePageFrom: number;
  sourcePageTo: number;
  role: "main" | "skip";
};

// Chapter / Part / Book / Act + optional number / roman / word ("CHAPTER ONE")
const HEADING_RE =
  /^(?:chapter|part|book|act|prologue|epilogue|introduction|preface|contents|table of contents)(?:[\s.:\-]+(?:[IVXLCDM]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))?[\s.:\-]*$/i;

const SKIP_TITLE_RE =
  /^(front matter|contents|table of contents|preface|introduction|copyright|dedication|acknowledg(e)?ments?|index|glossary|bibliography|about the author)\b/i;

const ALL_CAPS_TITLE_RE = /^[A-Z0-9][A-Z0-9\s,'"«»\-:]{2,60}$/;

function pageIsSparse(text: string): boolean {
  return (text || "").trim().length < 40;
}

function pageIsSubstantial(text: string): boolean {
  return (text || "").trim().length >= 40;
}

/** First non-empty lines of a page (heading candidates). */
function topLines(text: string, max = 4): string[] {
  return (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function extractHeadingTitle(pageText: string): string | null {
  for (const line of topLines(pageText)) {
    if (HEADING_RE.test(line)) {
      // Prefer a clean title: collapse whitespace, cap length
      return line.replace(/\s+/g, " ").trim().slice(0, 120);
    }
    // Short all-caps line that isn't just a number
    if (
      ALL_CAPS_TITLE_RE.test(line) &&
      !/^\d+$/.test(line) &&
      line.split(/\s+/).length <= 8 &&
      line.length >= 4
    ) {
      return line.replace(/\s+/g, " ").trim().slice(0, 120);
    }
  }
  return null;
}

/**
 * Segment pages into chapters.
 * - New chapter at first page, explicit headings, or after a blank page gap into content.
 * - Short books with no headings → single main chapter spanning content pages.
 * - Sparse leading pages can form a skip "Front matter" block when followed by a heading or content.
 */
export function detectChaptersFromPageBreaks(pageTexts: string[]): Chapter[] {
  const n = pageTexts.length;
  if (n === 0) return [];

  type Break = { page: number; title: string | null; forceSkip?: boolean };
  const breaks: Break[] = [{ page: 1, title: extractHeadingTitle(pageTexts[0] || "") }];

  for (let i = 1; i < n; i++) {
    const pageNum = i + 1;
    const text = pageTexts[i] || "";
    const prev = pageTexts[i - 1] || "";
    const heading = extractHeadingTitle(text);

    if (heading) {
      breaks.push({ page: pageNum, title: heading });
      continue;
    }
    // Blank page then substantial content → new chapter at content page
    if (pageIsSparse(prev) && pageIsSubstantial(text)) {
      breaks.push({ page: pageNum, title: null });
    }
  }

  // Build ranges
  const chapters: Chapter[] = [];
  for (let b = 0; b < breaks.length; b++) {
    const from = breaks[b].page;
    const to = b + 1 < breaks.length ? breaks[b + 1].page - 1 : n;
    if (to < from) continue;

    // Combined text in range for role heuristic
    let combinedLen = 0;
    for (let p = from; p <= to; p++) {
      combinedLen += (pageTexts[p - 1] || "").trim().length;
    }

    const title =
      breaks[b].title ||
      (chapters.length === 0 && pageIsSparse(pageTexts[from - 1] || "")
        ? "Front matter"
        : `Chapter ${chapters.length + 1}`);

    const isFrontish =
      SKIP_TITLE_RE.test(title.trim()) || (combinedLen < 40 && b === 0);

    chapters.push({
      chapterIndex: chapters.length,
      title,
      sourcePageFrom: from,
      sourcePageTo: to,
      role: isFrontish ? "skip" : "main",
    });
  }

  // If every chapter is skip, promote the longest to main
  if (chapters.length > 0 && chapters.every((c) => c.role === "skip")) {
    let best = 0;
    let bestLen = -1;
    for (let i = 0; i < chapters.length; i++) {
      let len = 0;
      for (let p = chapters[i].sourcePageFrom; p <= chapters[i].sourcePageTo; p++) {
        len += (pageTexts[p - 1] || "").trim().length;
      }
      if (len > bestLen) {
        bestLen = len;
        best = i;
      }
    }
    chapters[best] = { ...chapters[best], role: "main", title: chapters[best].title || "Chapter 1" };
  }

  // No structural breaks beyond page 1 and book is all one block already — ok.
  // If only one sparse chapter, still return it (caller may skip).
  if (chapters.length === 0) {
    const anyText = pageTexts.some((t) => pageIsSubstantial(t));
    return [
      {
        chapterIndex: 0,
        title: "Chapter 1",
        sourcePageFrom: 1,
        sourcePageTo: n,
        role: anyText ? "main" : "skip",
      },
    ];
  }

  // Re-index
  return chapters.map((c, i) => ({ ...c, chapterIndex: i }));
}

/** Lite package: one plot unit per main chapter (multi-page range allowed). */
export function unitsFromChapters(
  chapters: Chapter[]
): Array<{
  unitIndex: number;
  sourcePageFrom: number;
  sourcePageTo: number;
  role: "main" | "side" | "skip";
  title: string;
  rationale: string;
  chapterIndex: number;
}> {
  return chapters.map((c) => ({
    unitIndex: c.chapterIndex,
    sourcePageFrom: c.sourcePageFrom,
    sourcePageTo: c.sourcePageTo,
    role: c.role === "main" ? ("main" as const) : ("skip" as const),
    title: c.title,
    rationale:
      c.role === "main"
        ? `Lite package: one illustration for chapter pages ${c.sourcePageFrom}–${c.sourcePageTo}`
        : `Lite package: skip non-plot block (${c.title})`,
    chapterIndex: c.chapterIndex,
  }));
}
