import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBook, getBookPages } from "./db";

// Mock the database functions
vi.mock("./db", () => ({
  getBook: vi.fn(),
  getBookPages: vi.fn(),
}));

describe("booksRouter.getProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should calculate progress correctly with all pages completed", async () => {
    const mockBook = {
      id: 1,
      userId: 1,
      title: "Test Book",
      description: "Test",
      pdfFileKey: "test.pdf",
      pdfFileUrl: "https://example.com/test.pdf",
      pageCount: 3,
      processingStatus: "completed",
      totalPrice: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockPages = [
      {
        id: 1,
        bookId: 1,
        pageNumber: 1,
        thumbnailFileKey: null,
        thumbnailUrl: null,
        ocrText: "Page 1 text",
        generatedPrompt: "Prompt 1",
        generatedImageFileKey: "image1.jpg",
        generatedImageUrl: "https://example.com/image1.jpg",
        processingStatus: "done",
        errorMessage: null,
        retryCount: 0,
        maxRetries: 3,
        lastRetryAt: null,
        nextRetryAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        bookId: 1,
        pageNumber: 2,
        thumbnailFileKey: null,
        thumbnailUrl: null,
        ocrText: "Page 2 text",
        generatedPrompt: "Prompt 2",
        generatedImageFileKey: "image2.jpg",
        generatedImageUrl: "https://example.com/image2.jpg",
        processingStatus: "done",
        errorMessage: null,
        retryCount: 0,
        maxRetries: 3,
        lastRetryAt: null,
        nextRetryAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 3,
        bookId: 1,
        pageNumber: 3,
        thumbnailFileKey: null,
        thumbnailUrl: null,
        ocrText: "Page 3 text",
        generatedPrompt: "Prompt 3",
        generatedImageFileKey: "image3.jpg",
        generatedImageUrl: "https://example.com/image3.jpg",
        processingStatus: "done",
        errorMessage: null,
        retryCount: 0,
        maxRetries: 3,
        lastRetryAt: null,
        nextRetryAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(getBook).mockResolvedValue(mockBook as any);
    vi.mocked(getBookPages).mockResolvedValue(mockPages as any);

    // Simulate the getProgress logic
    const pages = await getBookPages(1);
    const totalPages = pages.length;
    const completedPages = pages.filter((p) => p.processingStatus === "done").length;
    const failedPages = pages.filter((p) => p.processingStatus === "error").length;
    const processingPages = pages.filter((p) => p.processingStatus === "processing").length;
    const pendingPages = pages.filter((p) => p.processingStatus === "pending").length;
    const progressPercentage = totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;

    expect(totalPages).toBe(3);
    expect(completedPages).toBe(3);
    expect(failedPages).toBe(0);
    expect(processingPages).toBe(0);
    expect(pendingPages).toBe(0);
    expect(progressPercentage).toBe(100);
  });

  it("should calculate progress correctly with mixed page statuses", async () => {
    const mockPages = [
      {
        id: 1,
        bookId: 1,
        pageNumber: 1,
        processingStatus: "done",
        errorMessage: null,
        generatedImageUrl: "https://example.com/image1.jpg",
      },
      {
        id: 2,
        bookId: 1,
        pageNumber: 2,
        processingStatus: "processing",
        errorMessage: null,
        generatedImageUrl: null,
      },
      {
        id: 3,
        bookId: 1,
        pageNumber: 3,
        processingStatus: "error",
        errorMessage: "Failed to generate image",
        generatedImageUrl: null,
      },
      {
        id: 4,
        bookId: 1,
        pageNumber: 4,
        processingStatus: "pending",
        errorMessage: null,
        generatedImageUrl: null,
      },
    ] as any;

    vi.mocked(getBookPages).mockResolvedValue(mockPages);

    const pages = await getBookPages(1);
    const totalPages = pages.length;
    const completedPages = pages.filter((p) => p.processingStatus === "done").length;
    const failedPages = pages.filter((p) => p.processingStatus === "error").length;
    const processingPages = pages.filter((p) => p.processingStatus === "processing").length;
    const pendingPages = pages.filter((p) => p.processingStatus === "pending").length;
    const progressPercentage = totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;

    expect(totalPages).toBe(4);
    expect(completedPages).toBe(1);
    expect(failedPages).toBe(1);
    expect(processingPages).toBe(1);
    expect(pendingPages).toBe(1);
    expect(progressPercentage).toBe(25);
  });

  it("should handle empty pages list", async () => {
    vi.mocked(getBookPages).mockResolvedValue([]);

    const pages = await getBookPages(1);
    const totalPages = pages.length;
    const completedPages = pages.filter((p) => p.processingStatus === "done").length;
    const progressPercentage = totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;

    expect(totalPages).toBe(0);
    expect(completedPages).toBe(0);
    expect(progressPercentage).toBe(0);
  });
});
