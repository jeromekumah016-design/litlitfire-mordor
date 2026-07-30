import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBook, getBookPages } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  getBook: vi.fn(),
  getBookPages: vi.fn(async () => []),
  getUserBooks: vi.fn(async () => []),
  createBook: vi.fn(),
  updateBook: vi.fn(),
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

function book(processingStatus: string, id: number) {
  return {
    id,
    userId: 1,
    title: "B",
    description: null,
    pdfFileKey: "k",
    pdfFileUrl: "https://cdn/k.pdf",
    pageCount: 1,
    processingStatus,
    totalPrice: "1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("booksRouter.getDetails caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT cache while the book is still processing", async () => {
    vi.mocked(getBook).mockResolvedValue(book("processing", 101) as any);
    const caller = appRouter.createCaller(authCtx());

    await caller.books.getDetails({ bookId: 101 });
    await caller.books.getDetails({ bookId: 101 });

    // Both calls must hit the DB — no stale cache masking live progress.
    expect(vi.mocked(getBook)).toHaveBeenCalledTimes(2);
  });

  it("caches once the book reaches a terminal state", async () => {
    vi.mocked(getBook).mockResolvedValue(book("completed", 202) as any);
    const caller = appRouter.createCaller(authCtx());

    await caller.books.getDetails({ bookId: 202 });
    await caller.books.getDetails({ bookId: 202 });

    // Second call served from cache.
    expect(vi.mocked(getBook)).toHaveBeenCalledTimes(1);
  });
});
