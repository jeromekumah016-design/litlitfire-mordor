import { describe, it, expect, vi, beforeEach } from "vitest";

// Only the Tesseract-facing OCR call is mocked -- ocrCacheService itself is
// exercised for real so this test proves the actual cache integration, not a
// mocked stand-in for it.
vi.mock("./ocrService", () => ({
  extractTextFromImage: vi.fn(),
}));

import { extractTextFromImage } from "./ocrService";
import { ocrCacheService } from "./ocrCacheService";
import { getOcrTextCached } from "./pipelineService";

const mOcr = vi.mocked(extractTextFromImage);

describe("getOcrTextCached (pipelineService OCR caching)", () => {
  beforeEach(() => {
    mOcr.mockReset();
    ocrCacheService.clearAll();
    ocrCacheService.resetStats();
  });

  it("calls Tesseract OCR on a cache miss and returns its text", async () => {
    mOcr.mockResolvedValueOnce({ text: "Chapter One", confidence: 0.9, language: "eng" });
    const buf = Buffer.from("page-image-bytes-A");

    const text = await getOcrTextCached(buf, "books/1/pages/1/thumbnail.png");

    expect(text).toBe("Chapter One");
    expect(mOcr).toHaveBeenCalledTimes(1);
  });

  it("skips Tesseract on a second call with identical buffer + scope key (cache hit)", async () => {
    mOcr.mockResolvedValueOnce({ text: "Chapter One", confidence: 0.9, language: "eng" });
    const buf = Buffer.from("page-image-bytes-A");
    const key = "books/1/pages/1/thumbnail.png";

    const first = await getOcrTextCached(buf, key);
    const second = await getOcrTextCached(buf, key); // identical content + key -> cache hit

    expect(first).toBe("Chapter One");
    expect(second).toBe("Chapter One");
    expect(mOcr).toHaveBeenCalledTimes(1); // Tesseract only touched once
  });

  it("re-runs OCR when the buffer content differs under the same scope key", async () => {
    mOcr
      .mockResolvedValueOnce({ text: "Chapter One", confidence: 0.9, language: "eng" })
      .mockResolvedValueOnce({ text: "Chapter One (re-rendered)", confidence: 0.88, language: "eng" });
    const key = "books/1/pages/1/thumbnail.png";

    const first = await getOcrTextCached(Buffer.from("bytes-v1"), key);
    const second = await getOcrTextCached(Buffer.from("bytes-v2"), key);

    expect(first).toBe("Chapter One");
    expect(second).toBe("Chapter One (re-rendered)");
    expect(mOcr).toHaveBeenCalledTimes(2);
  });

  it("re-runs OCR for identical bytes under a different scope key (different page)", async () => {
    mOcr
      .mockResolvedValueOnce({ text: "shared text", confidence: 0.9, language: "eng" })
      .mockResolvedValueOnce({ text: "shared text", confidence: 0.9, language: "eng" });
    const buf = Buffer.from("identical-bytes");

    await getOcrTextCached(buf, "books/1/pages/1/thumbnail.png");
    await getOcrTextCached(buf, "books/1/pages/2/thumbnail.png");

    expect(mOcr).toHaveBeenCalledTimes(2);
  });

  it("propagates OCR errors and does not cache a failed result", async () => {
    mOcr.mockRejectedValueOnce(new Error("OCR failed: boom"));
    const buf = Buffer.from("bytes-error");
    const key = "books/1/pages/1/thumbnail.png";

    await expect(getOcrTextCached(buf, key)).rejects.toThrow("OCR failed: boom");

    // A subsequent call should hit Tesseract again -- nothing was cached from the failure.
    mOcr.mockResolvedValueOnce({ text: "recovered text", confidence: 0.9, language: "eng" });
    const retryText = await getOcrTextCached(buf, key);
    expect(retryText).toBe("recovered text");
    expect(mOcr).toHaveBeenCalledTimes(2);
  });
});
