import { describe, it, expect, afterEach } from "vitest";
import {
  PIPELINE_MAX_PAGES,
  DEFAULT_DAILY_RENDER_PAGE_CAP,
  getDailyRenderPageCap,
  startOfUtcDay,
  renderUnitsForBook,
  isPipelineStarted,
  sumStartedRenderUnitsToday,
  decideAutoStartRender,
} from "./renderCap";

describe("renderCap", () => {
  const prev = process.env.DAILY_RENDER_PAGE_CAP;
  afterEach(() => {
    if (prev === undefined) delete process.env.DAILY_RENDER_PAGE_CAP;
    else process.env.DAILY_RENDER_PAGE_CAP = prev;
  });

  it("renderUnitsForBook caps at PIPELINE_MAX_PAGES", () => {
    expect(renderUnitsForBook(5)).toBe(5);
    expect(renderUnitsForBook(500)).toBe(PIPELINE_MAX_PAGES);
    expect(renderUnitsForBook(0)).toBe(0);
    expect(renderUnitsForBook(-1)).toBe(0);
  });

  it("getDailyRenderPageCap reads env with safe fallbacks", () => {
    delete process.env.DAILY_RENDER_PAGE_CAP;
    expect(getDailyRenderPageCap()).toBe(DEFAULT_DAILY_RENDER_PAGE_CAP);
    expect(getDailyRenderPageCap("10")).toBe(10);
    expect(getDailyRenderPageCap("0")).toBe(0);
    expect(getDailyRenderPageCap("nope")).toBe(DEFAULT_DAILY_RENDER_PAGE_CAP);
    expect(getDailyRenderPageCap("-5")).toBe(DEFAULT_DAILY_RENDER_PAGE_CAP);
  });

  it("startOfUtcDay is midnight UTC", () => {
    const d = startOfUtcDay(new Date("2026-07-21T15:30:00.000Z"));
    expect(d.toISOString()).toBe("2026-07-21T00:00:00.000Z");
  });

  it("sumStartedRenderUnitsToday counts only today's started books", () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    const books = [
      { pageCount: 10, processingStatus: "processing", createdAt: "2026-07-21T01:00:00.000Z" },
      { pageCount: 50, processingStatus: "completed", createdAt: "2026-07-21T02:00:00.000Z" }, // 20 units
      { pageCount: 15, processingStatus: "pending", createdAt: "2026-07-21T03:00:00.000Z" }, // excluded
      { pageCount: 20, processingStatus: "failed", createdAt: "2026-07-20T23:00:00.000Z" }, // yesterday
    ];
    expect(sumStartedRenderUnitsToday(books, now)).toBe(10 + 20);
    expect(isPipelineStarted("pending")).toBe(false);
    expect(isPipelineStarted("processing")).toBe(true);
  });

  it("decideAutoStartRender gates when used + book would exceed cap", () => {
    expect(decideAutoStartRender(0, 20, 40)).toEqual({
      allowed: true,
      used: 0,
      cap: 40,
      bookUnits: 20,
      remaining: 40,
    });
    expect(decideAutoStartRender(30, 20, 40).allowed).toBe(false);
    expect(decideAutoStartRender(40, 1, 40).allowed).toBe(false);
    expect(decideAutoStartRender(0, 20, 0).allowed).toBe(false);
    expect(decideAutoStartRender(39, 1, 40).allowed).toBe(true);
  });
});
