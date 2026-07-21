/**
 * Two-phase review gate pipeline (functional bar)
 * ================================================
 *
 * 1. extractAndStorePages  — PDF store already done by upload; this OCRs/extracts
 *    text into page rows. NO image generation.
 * 2. transcribeBook        — build storyBible once, persist, generate per-page
 *    prompts, set promptStatus = prompt_ready | prompt_error.
 * 3. setPagePromptApproval — human review: prompt_ready ↔ approved.
 * 4. renderApprovedImages  — DALL·E ONLY when promptStatus === "approved".
 *    Records the REAL generatedImageFileKey from generateImage().
 *
 * Decoupling: image gen receives prompt + keyPrefix + params only — never raw OCR.
 */

import { extractPDFPages, generatePageThumbnail } from "./pdfService";
import {
  buildStoryContext,
  generateImagePrompt,
  EmptyPageError,
  type StoryContext,
} from "./promptService";
import { generateImage } from "./_core/imageGeneration";
import { type ImageGenParams, normalizeImageParams } from "./_core/imageParams";
import { storagePut } from "./storage";
import {
  createPage,
  updatePage,
  getBookPages,
  getBook,
  updateBook,
  getPage,
} from "./db";

const MAX_PAGES = 20;

export type ExtractResult = { extracted: number; bookId: number };

/**
 * Upload phase (functional bar §1): create page rows with OCR text only.
 * Idempotent for pages that already have ocrText.
 */
export async function extractAndStorePages(
  bookId: number,
  pdfBuffer: Buffer
): Promise<ExtractResult> {
  const pdfData = await extractPDFPages(pdfBuffer);
  const totalPages = Math.min(pdfData.totalPages, MAX_PAGES);
  const existing = await getBookPages(bookId);
  const byNumber = new Map(existing.map((p) => [p.pageNumber, p]));

  let extracted = 0;
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    const text = pdfData.pages[pageNumber - 1]?.text ?? "";
    const prev = byNumber.get(pageNumber);
    if (prev?.ocrText && prev.ocrText.trim().length > 0) {
      extracted++;
      continue;
    }

    let thumbnailKey: string | undefined;
    let thumbnailUrl: string | undefined;
    try {
      const thumb = await generatePageThumbnail(pdfBuffer, pageNumber, 1.0);
      thumbnailKey = `books/${bookId}/pages/${pageNumber}/thumbnail.png`;
      const put = await storagePut(thumbnailKey, thumb, "image/png");
      thumbnailUrl = put.url;
    } catch (e) {
      console.warn(`[Gate] thumbnail failed page ${pageNumber}:`, e);
    }

    if (prev) {
      await updatePage(prev.id, {
        ocrText: text,
        thumbnailFileKey: thumbnailKey,
        thumbnailUrl,
        promptStatus: "pending",
        imageStatus: "pending",
        processingStatus: "pending",
      });
    } else {
      await createPage({
        bookId,
        pageNumber,
        ocrText: text,
        thumbnailFileKey: thumbnailKey,
        thumbnailUrl,
        processingStatus: "pending",
        promptStatus: "pending",
        imageStatus: "pending",
      });
    }
    extracted++;
  }

  await updateBook(bookId, { processingStatus: "pending", pageCount: totalPages } as any);
  return { extracted, bookId };
}

export type TranscribeResult = {
  bookId: number;
  transcribed: number;
  errors: number;
  biblePersisted: boolean;
  genres?: string[];
  mainUnits?: number;
  skippedPages?: number;
  packageTier?: "lite" | "upgraded";
  chapterCount?: number;
};

/**
 * Multi-pass reading (functional bar §2 + product plan):
 * genre discovery → plot map + storyBible → prompts for main plot units only.
 */
export async function transcribeBook(bookId: number): Promise<TranscribeResult> {
  const { runMultiPassReading } = await import("./readingPipeline");
  const result = await runMultiPassReading(bookId);
  return {
    bookId: result.bookId,
    transcribed: result.promptsReady,
    errors: result.errors,
    biblePersisted: result.biblePersisted,
    genres: result.genres,
    mainUnits: result.mainUnits,
    skippedPages: result.skippedPages,
    packageTier: result.packageTier,
    chapterCount: result.chapterCount,
  };
}

/**
 * Human review gate: only pages in prompt_ready (or already approved) may be flipped.
 */
export async function setPagePromptApproval(
  pageId: number,
  approved: boolean
): Promise<{ pageId: number; promptStatus: string }> {
  const page = await getPage(pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);

  if (approved) {
    if (page.promptStatus !== "prompt_ready" && page.promptStatus !== "approved") {
      throw new Error(
        `Cannot approve page ${pageId}: promptStatus is "${page.promptStatus}" (need prompt_ready)`
      );
    }
    if (!page.generatedPrompt?.trim()) {
      throw new Error(`Cannot approve page ${pageId}: empty generatedPrompt`);
    }
    await updatePage(pageId, { promptStatus: "approved" });
    return { pageId, promptStatus: "approved" };
  }

  // Un-approve only from approved → back to prompt_ready for re-edit cycle
  if (page.promptStatus === "approved") {
    if (page.imageStatus === "image_ready") {
      throw new Error(`Cannot un-approve page ${pageId}: image already rendered`);
    }
    await updatePage(pageId, { promptStatus: "prompt_ready" });
    return { pageId, promptStatus: "prompt_ready" };
  }

  return { pageId, promptStatus: page.promptStatus };
}

export type RenderResult = {
  bookId: number;
  rendered: number;
  skipped: number;
  errors: number;
};

/**
 * Re-render a single approved page from its persisted generatedPrompt.
 * Used by retryWorker / retryFailedPages. NEVER calls the LLM or rebuilds the bible.
 * Returns the storage key on success.
 */
export async function reRenderApprovedPage(
  pageId: number,
  imageParams?: Partial<ImageGenParams>
): Promise<{ url: string; key: string }> {
  const page = await getPage(pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);
  if (page.promptStatus !== "approved") {
    throw new Error(
      `reRenderApprovedPage: page ${pageId} promptStatus="${page.promptStatus}" (need approved) — refusing to regenerate prompts`
    );
  }
  const prompt = page.generatedPrompt?.trim();
  if (!prompt) {
    throw new Error(`reRenderApprovedPage: page ${pageId} has no persisted generatedPrompt`);
  }

  const params = normalizeImageParams(imageParams);
  await updatePage(pageId, {
    imageStatus: "generating",
    processingStatus: "processing",
    errorMessage: null,
  });

  try {
    const keyPrefix = `books/${page.bookId}/pages/${page.pageNumber}/generated`;
    const imageResult = await generateImage({ prompt, keyPrefix, params });
    if (!imageResult.url || !imageResult.key) {
      throw new Error("generateImage returned no url/key");
    }
    await updatePage(pageId, {
      generatedImageUrl: imageResult.url,
      generatedImageFileKey: imageResult.key,
      imageStatus: "image_ready",
      processingStatus: "done",
      errorMessage: null,
    });
    return { url: imageResult.url, key: imageResult.key };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updatePage(pageId, {
      imageStatus: "image_error",
      processingStatus: "error",
      errorMessage: msg,
    });
    throw e;
  }
}

/**
 * Render phase (functional bar §0 + §3): ONLY promptStatus === "approved".
 * Uses persisted page.generatedPrompt only — never calls generateImagePrompt.
 * Always records the real storage key returned by generateImage.
 */
export async function renderApprovedImages(
  bookId: number,
  imageParams?: Partial<ImageGenParams>
): Promise<RenderResult> {
  const book = await getBook(bookId);
  if (!book) throw new Error(`Book ${bookId} not found`);

  const pages = await getBookPages(bookId);
  const params = normalizeImageParams(imageParams);
  let rendered = 0;
  let skipped = 0;
  let errors = 0;

  // Render in ascending page number order
  const ordered = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  for (const page of ordered) {
    // HARD SERVER GATE — no exceptions
    if (page.promptStatus !== "approved") {
      skipped++;
      continue;
    }
    if (page.imageStatus === "image_ready" && page.generatedImageUrl) {
      skipped++;
      continue;
    }
    if (page.skipSuggested) {
      skipped++;
      continue;
    }
    const prompt = page.generatedPrompt?.trim();
    if (!prompt) {
      await updatePage(page.id, {
        imageStatus: "image_error",
        errorMessage: "Approved page has no generatedPrompt",
      });
      errors++;
      continue;
    }

    await updatePage(page.id, { imageStatus: "generating", processingStatus: "processing" });
    try {
      const keyPrefix = `books/${bookId}/pages/${page.pageNumber}/generated`;
      const imageResult = await generateImage({
        prompt,
        keyPrefix,
        params,
      });
      if (!imageResult.url || !imageResult.key) {
        throw new Error(
          "generateImage returned no url/key — refusing to mark image_ready without a real storage key"
        );
      }
      await updatePage(page.id, {
        generatedImageUrl: imageResult.url,
        generatedImageFileKey: imageResult.key,
        imageStatus: "image_ready",
        processingStatus: "done",
        errorMessage: null,
      });
      rendered++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await updatePage(page.id, {
        imageStatus: "image_error",
        processingStatus: "error",
        errorMessage: msg,
      });
      errors++;
    }
  }

  const fresh = await getBookPages(bookId);
  const anyReady = fresh.some((p) => p.imageStatus === "image_ready");
  const anyPending = fresh.some(
    (p) => p.promptStatus === "approved" && p.imageStatus !== "image_ready"
  );
  await updateBook(bookId, {
    processingStatus: anyReady && !anyPending ? "completed" : anyReady ? "processing" : book.processingStatus,
  } as any);

  return { bookId, rendered, skipped, errors };
}
