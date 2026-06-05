import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { getBook, deleteBook } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  getBook: vi.fn(),
  deleteBook: vi.fn(async () => undefined),
  getUserBooks: vi.fn(async () => []),
  getBookPages: vi.fn(async () => []),
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

const book = (userId: number) => ({
  id: 5,
  userId,
  title: "B",
  description: null,
  pdfFileKey: "k",
  pdfFileUrl: "https://cdn/k.pdf",
  pageCount: 1,
  processingStatus: "completed",
  totalPrice: "1",
  createdAt: new Date(),
  updatedAt: new Date(),
});

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof TRPCError ? e.code : "NOT_TRPC";
  }
  return undefined;
}

describe("booksRouter.delete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a book owned by the caller", async () => {
    vi.mocked(getBook).mockResolvedValue(book(1) as any);
    const caller = appRouter.createCaller(authCtx());

    const res = await caller.books.delete({ bookId: 5 });

    expect(res).toEqual({ success: true, bookId: 5 });
    expect(deleteBook).toHaveBeenCalledWith(5);
  });

  it("rejects deleting a book owned by someone else (FORBIDDEN)", async () => {
    vi.mocked(getBook).mockResolvedValue(book(999) as any);
    const caller = appRouter.createCaller(authCtx());

    expect(await codeOf(caller.books.delete({ bookId: 5 }))).toBe("FORBIDDEN");
    expect(deleteBook).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for a missing book", async () => {
    vi.mocked(getBook).mockResolvedValue(undefined as any);
    const caller = appRouter.createCaller(authCtx());

    expect(await codeOf(caller.books.delete({ bookId: 5 }))).toBe("NOT_FOUND");
    expect(deleteBook).not.toHaveBeenCalled();
  });
});
