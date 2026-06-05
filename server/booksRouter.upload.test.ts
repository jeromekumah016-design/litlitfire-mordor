import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { getPDFMetadata } from "./pdfService";
import { createBook } from "./db";
import { processBookPipeline } from "./pipelineService";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

vi.mock("./pdfService", () => ({ getPDFMetadata: vi.fn() }));
vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ key, url: `https://cdn/${key}` })),
}));
vi.mock("./db", () => ({
  createBook: vi.fn(),
  getUserBooks: vi.fn(async () => []),
  getBook: vi.fn(),
  getBookPages: vi.fn(async () => []),
  updateBook: vi.fn(),
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

const input = () => ({
  title: "My Book",
  description: "d",
  pdfData: Buffer.from("%PDF-1.7 hello").toString("base64"),
});

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    return e instanceof TRPCError ? e.code : "NOT_TRPC";
  }
  return undefined;
}

describe("booksRouter.upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects PDFs over the page limit with BAD_REQUEST (not 500)", async () => {
    vi.mocked(getPDFMetadata).mockResolvedValue({ totalPages: 600 } as any);
    const caller = appRouter.createCaller(authCtx());

    expect(await codeOf(caller.books.upload(input()))).toBe("BAD_REQUEST");
    expect(createBook).not.toHaveBeenCalled();
    expect(processBookPipeline).not.toHaveBeenCalled();
  });

  it("surfaces a null book as INTERNAL_SERVER_ERROR", async () => {
    vi.mocked(getPDFMetadata).mockResolvedValue({ totalPages: 5 } as any);
    vi.mocked(createBook).mockResolvedValue(null);
    const caller = appRouter.createCaller(authCtx());

    expect(await codeOf(caller.books.upload(input()))).toBe(
      "INTERNAL_SERVER_ERROR"
    );
    expect(processBookPipeline).not.toHaveBeenCalled();
  });

  it("creates the book and kicks off processing on success", async () => {
    vi.mocked(getPDFMetadata).mockResolvedValue({ totalPages: 5 } as any);
    vi.mocked(createBook).mockResolvedValue({
      id: 11,
      title: "My Book",
      pageCount: 5,
      totalPrice: "5",
    } as any);
    const caller = appRouter.createCaller(authCtx());

    const res = await caller.books.upload(input());

    expect(res).toMatchObject({ bookId: 11, processingStatus: "processing" });
    expect(processBookPipeline).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processBookPipeline).mock.calls[0][0]).toBe(11);
  });
});
