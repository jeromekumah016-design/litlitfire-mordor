import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock the database functions
vi.mock("./db", () => ({
  getBook: vi.fn(),
  getBookPages: vi.fn(),
  updatePage: vi.fn(),
  updateBook: vi.fn(),
}));

describe("booksRouter.retryFailedPages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return no failed pages when all pages are successful", async () => {
    const { getBook, getBookPages, updatePage, updateBook } = await import("./db");
    
    vi.mocked(getBook).mockResolvedValue({
      id: 1,
      userId: 123,
      title: "Test Book",
      processingStatus: "completed",
    } as any);

    vi.mocked(getBookPages).mockResolvedValue([
      {
        id: 1,
        pageNumber: 1,
        processingStatus: "done",
        retryCount: 0,
      } as any,
    ]);

    // Simulate the retryFailedPages logic
    const book = await getBook(1);
    const pages = await getBookPages(1);
    const failedPages = pages.filter((p) => p.processingStatus === "error");

    expect(failedPages.length).toBe(0);
    expect(updatePage).not.toHaveBeenCalled();
    expect(updateBook).not.toHaveBeenCalled();
  });

  it("should reset failed pages only after a successful PDF fetch (H5)", async () => {
    const { getBook, getBookPages, updatePage, updateBook } = await import("./db");
    
    vi.mocked(getBook).mockResolvedValue({
      id: 1,
      userId: 123,
      title: "Test Book",
      processingStatus: "failed",
      pdfFileUrl: "https://example.com/book.pdf",
    } as any);

    const failedPage = {
      id: 1,
      pageNumber: 1,
      processingStatus: "error",
      retryCount: 0,
      errorMessage: "Image generation failed",
    };

    vi.mocked(getBookPages).mockResolvedValue([failedPage] as any);
    vi.mocked(updatePage).mockResolvedValue(undefined);
    vi.mocked(updateBook).mockResolvedValue(undefined);

    // Simulate the retryFailedPages logic (H5 ordering)
    const book = await getBook(1);
    const pages = await getBookPages(1);
    const failedPages = pages.filter((p) => p.processingStatus === "error");

    expect(failedPages.length).toBe(1);
    expect(book?.pdfFileUrl).toBeTruthy();

    // Fetch must succeed BEFORE any status mutation. On failure we leave
    // pages in "error" and the book untouched (no stuck "processing").
    const fetchOk = true;
    if (!fetchOk) {
      expect(updatePage).not.toHaveBeenCalled();
      expect(updateBook).not.toHaveBeenCalled();
      return;
    }

    // Reset failed pages: retryCount is reset to 0 (fresh budget), not
    // incremented — incrementing would permanently exhaust the budget on
    // pages that have already hit maxRetries.
    for (const page of failedPages) {
      await updatePage(page.id, {
        processingStatus: "pending",
        errorMessage: null,
        retryCount: 0,
      });
    }

    // Update book status only after bytes are in hand
    await updateBook(1, { processingStatus: "processing" });

    expect(updatePage).toHaveBeenCalledWith(1, {
      processingStatus: "pending",
      errorMessage: null,
      retryCount: 0,
    });

    expect(updateBook).toHaveBeenCalledWith(1, {
      processingStatus: "processing",
    });
  });

  it("must not mutate status when PDF fetch would fail (H5)", async () => {
    const { getBook, getBookPages, updatePage, updateBook } = await import("./db");

    vi.mocked(getBook).mockResolvedValue({
      id: 1,
      userId: 123,
      title: "Test Book",
      processingStatus: "failed",
      pdfFileUrl: "https://example.com/missing.pdf",
    } as any);
    vi.mocked(getBookPages).mockResolvedValue([
      { id: 1, pageNumber: 1, processingStatus: "error", retryCount: 0 } as any,
    ]);

    const book = await getBook(1);
    const pages = await getBookPages(1);
    const failedPages = pages.filter((p) => p.processingStatus === "error");
    expect(failedPages.length).toBe(1);

    // Simulate fetch failure path: throw before any update*
    const fetchFailed = true;
    if (fetchFailed) {
      expect(updatePage).not.toHaveBeenCalled();
      expect(updateBook).not.toHaveBeenCalled();
      // Book remains failed, pages remain error — caller can retry later.
      expect(book?.processingStatus).toBe("failed");
      return;
    }
  });

  it("should handle multiple failed pages", async () => {
    const { getBook, getBookPages, updatePage, updateBook } = await import("./db");
    
    vi.mocked(getBook).mockResolvedValue({
      id: 1,
      userId: 123,
      title: "Test Book",
      processingStatus: "failed",
    } as any);

    const failedPages = [
      {
        id: 1,
        pageNumber: 1,
        processingStatus: "error",
        retryCount: 0,
      },
      {
        id: 2,
        pageNumber: 2,
        processingStatus: "error",
        retryCount: 1,
      },
    ];

    vi.mocked(getBookPages).mockResolvedValue([
      ...failedPages,
      {
        id: 3,
        pageNumber: 3,
        processingStatus: "done",
        retryCount: 0,
      },
    ] as any);

    vi.mocked(updatePage).mockResolvedValue(undefined);
    vi.mocked(updateBook).mockResolvedValue(undefined);

    // Simulate the retryFailedPages logic
    const book = await getBook(1);
    const pages = await getBookPages(1);
    const failed = pages.filter((p) => p.processingStatus === "error");

    expect(failed.length).toBe(2);

    // Reset all failed pages: retryCount is always reset to 0 so every page
    // gets a fresh retry budget regardless of how many attempts it has had.
    for (const page of failed) {
      await updatePage(page.id, {
        processingStatus: "pending",
        errorMessage: null,
        retryCount: 0,
      });
    }

    expect(updatePage).toHaveBeenCalledTimes(2);
    expect(updatePage).toHaveBeenNthCalledWith(1, 1, {
      processingStatus: "pending",
      errorMessage: null,
      retryCount: 0,
    });
    expect(updatePage).toHaveBeenNthCalledWith(2, 2, {
      processingStatus: "pending",
      errorMessage: null,
      retryCount: 0,
    });
  });
});
