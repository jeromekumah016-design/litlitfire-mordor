import { describe, it, expect } from "vitest";
import {
  detectChaptersFromPageBreaks,
  extractHeadingTitle,
  unitsFromChapters,
} from "./chapterDetect";

describe("extractHeadingTitle", () => {
  it("finds Chapter N headings", () => {
    expect(extractHeadingTitle("Chapter 1\nOnce upon a time")).toMatch(/Chapter 1/i);
  });

  it("finds Part headings", () => {
    expect(extractHeadingTitle("Part II\nThe journey continues with many words")).toMatch(
      /Part II/i
    );
  });
});

describe("detectChaptersFromPageBreaks", () => {
  it("splits on chapter headings at page breaks", () => {
    const chapters = detectChaptersFromPageBreaks([
      "Chapter 1\nOnce upon a time in a riverside town with plenty of narrative text",
      "More of chapter one continues with even more story words here for density",
      "Chapter 2\nCaptain Ellis arrived with a weathered map of the coast and friends",
    ]);
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    expect(chapters[0].sourcePageFrom).toBe(1);
    expect(chapters[1].title).toMatch(/Chapter 2/i);
    expect(chapters[1].sourcePageFrom).toBe(3);
  });

  it("starts a chapter after blank page gap", () => {
    const chapters = detectChaptersFromPageBreaks([
      "Chapter opening with a long enough string of words to count as content here",
      "",
      "Suddenly the plot resumes with another long block of narrative text on this page",
    ]);
    expect(chapters.some((c) => c.sourcePageFrom === 3)).toBe(true);
  });

  it("uses a single chapter when no headings", () => {
    const chapters = detectChaptersFromPageBreaks([
      "A continuous story without headings and lots of words on page one of the book",
      "Page two continues the same narrative with more words and no chapter marker at all",
    ]);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].sourcePageFrom).toBe(1);
    expect(chapters[0].sourcePageTo).toBe(2);
    expect(chapters[0].role).toBe("main");
  });

  it("detects CHAPTER ONE word form and skips Contents", () => {
    const chapters = detectChaptersFromPageBreaks([
      "Contents\nChapter 1 ............. 3\nChapter 2 ............. 10",
      "CHAPTER ONE\nThe journey begins with a long enough block of narrative prose here",
      "CHAPTER TWO\nLater events unfold with another long enough block of story text",
    ]);
    const contents = chapters.find((c) => /contents/i.test(c.title));
    expect(contents?.role).toBe("skip");
    const main = chapters.filter((c) => c.role === "main");
    expect(main.length).toBeGreaterThanOrEqual(2);
    expect(main.some((c) => /ONE|Chapter/i.test(c.title))).toBe(true);
  });
});

describe("unitsFromChapters", () => {
  it("maps main chapters to plot units with page ranges", () => {
    const units = unitsFromChapters([
      {
        chapterIndex: 0,
        title: "Chapter 1",
        sourcePageFrom: 1,
        sourcePageTo: 3,
        role: "main",
      },
      {
        chapterIndex: 1,
        title: "Contents",
        sourcePageFrom: 4,
        sourcePageTo: 4,
        role: "skip",
      },
    ]);
    expect(units[0].role).toBe("main");
    expect(units[0].sourcePageFrom).toBe(1);
    expect(units[0].sourcePageTo).toBe(3);
    expect(units[1].role).toBe("skip");
  });
});
