import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBook, updateBook } from "./db";
import { processBookPipeline } from "./pipelineService";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  getBook: vi.fn(),
  updateBook: vi.fn(async () => undefined),
  getUserBooks: vi.fn(async () => []),
  getBookPages: vi.fn(async () => []),
  createBook: vi.fn(),
}));

vi.mock("./pipelineService", () => ({
  processBookPipeline: vi.fn(async () => ({ successCount: 1, failureCount: 0 })),
}));

function authCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "u1",
      email: "u@example.com",
      name: "U",
      loginMethod: "google",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as unknown as TrpcContext;
}

/** Flush pending microtasks so the fire-and-forget background task runs. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("booksRouter.processPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ownedPendingBook = {
    id: 1,
    userId: 1,
    title: "B",
    description: null,
    pdfFileKey: "books/1/x.pdf",
    pdfFileUrl: "https://cdn.example.com/books/1/x.pdf",
    pageCount: 2,
    processingStatus: "pending",
    totalPrice: "1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("downloads the stored PDF and triggers the pipeline", async () => {
    vi.mocked(getBook).mockResolvedValue(ownedPendingBook as any);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => new TextEncoder().encode("%PDF-1.7").buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const caller = appRouter.createCaller(authCtx());
    const result = await caller.books.processPdf({ bookId: 1 });

    expect(result).toMatchObject({ bookId: 1, status: "processing" });
    expect(updateBook).toHaveBeenCalledWith(1, { processingStatus: "processing" });

    await flush();

    expect(fetchMock).toHaveBeenCalledWith(ownedPendingBook.pdfFileUrl);
    expect(processBookPipeline).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processBookPipeline).mock.calls[0][0]).toBe(1);
  });

  it("flips the book back to failed when the PDF download fails", async () => {
    vi.mocked(getBook).mockResolvedValue(ownedPendingBook as any);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" }))
    );

    const caller = appRouter.createCaller(authCtx());
    await caller.books.processPdf({ bookId: 1 });
    await flush();

    expect(processBookPipeline).not.toHaveBeenCalled();
    expect(updateBook).toHaveBeenCalledWith(1, { processingStatus: "failed" });
  });

  it("does not reprocess a book already processing", async () => {
    vi.mocked(getBook).mockResolvedValue({
      ...ownedPendingBook,
      processingStatus: "processing",
    } as any);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const caller = appRouter.createCaller(authCtx());
    const result = await caller.books.processPdf({ bookId: 1 });
    await flush();

    expect(result.status).toBe("processing");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(processBookPipeline).not.toHaveBeenCalled();
  });

  it("rejects when the caller does not own the book", async () => {
    vi.mocked(getBook).mockResolvedValue({
      ...ownedPendingBook,
      userId: 999,
    } as any);

    const caller = appRouter.createCaller(authCtx());
    await expect(caller.books.processPdf({ bookId: 1 })).rejects.toThrow();
    expect(processBookPipeline).not.toHaveBeenCalled();
  });
});
