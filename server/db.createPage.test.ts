import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * createPage must upsert by (bookId, pageNumber): a retry re-runs the page
 * pipeline, which calls createPage again for the same page. Before the fix this
 * blindly INSERTed, producing duplicate page rows. These tests drive a fake
 * drizzle client and assert insert-vs-update is chosen correctly.
 */

const state = vi.hoisted(() => ({ db: null as any }));

vi.mock("pg", () => ({ Pool: vi.fn().mockImplementation(() => ({})) }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => state.db }));

type Calls = { insert: number; update: number; updateSet?: Record<string, unknown> };

function buildDb(opts: {
  selectRows: unknown[];
  updateRows?: unknown[];
  insertRows?: unknown[];
  calls: Calls;
}) {
  const sel = {
    from: () => sel,
    where: () => sel,
    orderBy: () => sel,
    limit: () => Promise.resolve(opts.selectRows),
  };
  const upd = {
    set: (s: Record<string, unknown>) => {
      opts.calls.updateSet = s;
      return upd;
    },
    where: () => upd,
    returning: () => {
      opts.calls.update++;
      return Promise.resolve(opts.updateRows ?? []);
    },
  };
  const ins = {
    values: () => ins,
    returning: () => {
      opts.calls.insert++;
      return Promise.resolve(opts.insertRows ?? []);
    },
  };
  return { select: () => sel, update: () => upd, insert: () => ins };
}

describe("createPage upsert", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
  });

  it("inserts when no row exists for (bookId, pageNumber)", async () => {
    const calls: Calls = { insert: 0, update: 0 };
    state.db = buildDb({
      selectRows: [],
      insertRows: [{ id: 1, bookId: 1, pageNumber: 1, processingStatus: "done" }],
      calls,
    });

    const { createPage } = await import("./db");
    const res = await createPage({
      bookId: 1,
      pageNumber: 1,
      processingStatus: "done",
    } as any);

    expect(calls.insert).toBe(1);
    expect(calls.update).toBe(0);
    expect(res).toMatchObject({ id: 1, processingStatus: "done" });
  });

  it("updates the existing row instead of inserting a duplicate", async () => {
    const calls: Calls = { insert: 0, update: 0 };
    state.db = buildDb({
      selectRows: [{ id: 7, bookId: 1, pageNumber: 2, processingStatus: "error" }],
      updateRows: [{ id: 7, bookId: 1, pageNumber: 2, processingStatus: "done" }],
      calls,
    });

    const { createPage } = await import("./db");
    const res = await createPage({
      bookId: 1,
      pageNumber: 2,
      processingStatus: "done",
      generatedImageUrl: "https://cdn/x.png",
    } as any);

    expect(calls.update).toBe(1);
    expect(calls.insert).toBe(0);
    expect(res).toMatchObject({ id: 7, processingStatus: "done" });
    // bookId/pageNumber must not be in the update set; provided fields must be.
    expect(calls.updateSet).not.toHaveProperty("bookId");
    expect(calls.updateSet).not.toHaveProperty("pageNumber");
    expect(calls.updateSet).toMatchObject({
      processingStatus: "done",
      generatedImageUrl: "https://cdn/x.png",
    });
  });

  it("omits undefined fields from the update set", async () => {
    const calls: Calls = { insert: 0, update: 0 };
    state.db = buildDb({
      selectRows: [{ id: 9, bookId: 3, pageNumber: 4 }],
      updateRows: [{ id: 9 }],
      calls,
    });

    const { createPage } = await import("./db");
    await createPage({
      bookId: 3,
      pageNumber: 4,
      processingStatus: "error",
      generatedImageUrl: undefined,
      generatedImageFileKey: undefined,
    } as any);

    expect(calls.updateSet).not.toHaveProperty("generatedImageUrl");
    expect(calls.updateSet).not.toHaveProperty("generatedImageFileKey");
    expect(calls.updateSet).toHaveProperty("processingStatus", "error");
  });
});
