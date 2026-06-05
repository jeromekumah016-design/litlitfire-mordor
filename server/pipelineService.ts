import { extractPDFPages, generatePageThumbnail } from "./pdfService";
import { extractTextFromImage } from "./ocrService";
import {
  generateImagePrompt,
  generateImagePromptsWithContext,
  buildStoryContext,
  type PageContext,
  type StoryContext,
} from "./promptService";
import { generateImage } from "./_core/imageGeneration";
import { storagePut } from "./storage";
import {
  createPage,
  updatePage,
  getBookPages,
  createProcessingJob,
  updateProcessingJob,
  updateBook,
} from "./db";
import { markPageForRetry } from "./retryService";
import type { Page } from "../drizzle/schema";

export interface PipelineProgress {
  bookId: number;
  totalPages: number;
  processedPages: number;
  currentPage: number;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
}

function extractCharactersFromText(text: string): string[] {
  const characters: string[] = [];
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  const matches = text.match(namePattern) || [];
  const commonWords = new Set(["The","And","But","For","With","From","That","This","Which","When","Where","Why","How"]);
  matches.forEach((match) => { if (!commonWords.has(match) && characters.length < 5) characters.push(match); });
  const uniqueCharacters: string[] = [];
  const seen = new Set<string>();
  for (const char of characters) { if (!seen.has(char)) { uniqueCharacters.push(char); seen.add(char); } }
  return uniqueCharacters;
}

/**
 * Process a single page with context awareness from previous pages.
 * FIX: pushes a PageContext into previousContexts on success so later pages
 * benefit from what was already illustrated.
 */
async function processPagePipelineWithContext(
  bookId: number,
  pageNumber: number,
  pdfBuffer: Buffer,
  ocrText: string,
  previousContexts: PageContext[], // mutated in place on success
  storyContext: StoryContext | null,
  onProgress?: (progress: PipelineProgress) => void
): Promise<Page | null> {
  try {
    console.log(`[Pipeline] Processing page ${pageNumber}: Extracting thumbnail...`);
    const thumbnailBuffer = await generatePageThumbnail(pdfBuffer, pageNumber, 1.0);
    const thumbnailKey = `books/${bookId}/pages/${pageNumber}/thumbnail.png`;
    const { url: thumbnailUrl } = await storagePut(thumbnailKey, thumbnailBuffer, "image/png");

    console.log(`[Pipeline] Processing page ${pageNumber}: Generating prompt...`);
    const promptResult = await generateImagePrompt(
      ocrText, pageNumber,
      previousContexts.length > 0 ? previousContexts : undefined,
      storyContext
    );

    console.log(`[Pipeline] Processing page ${pageNumber}: Generating image...`);
    let generatedImageUrl: string | null = null;
    let generatedImageKey: string | null = null;

    try {
      const imageResult = await generateImage({ prompt: promptResult.prompt });
      if (imageResult.url) {
        generatedImageUrl = imageResult.url;
        generatedImageKey = `books/${bookId}/pages/${pageNumber}/generated.png`;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Pipeline] Failed to generate image for page ${pageNumber}:`, errorMsg);
      const errorPage = await createPage({ bookId, pageNumber, thumbnailFileKey: thumbnailKey, thumbnailUrl, ocrText, generatedPrompt: promptResult.prompt, processingStatus: "error", errorMessage: `Image generation failed: ${errorMsg}` });
      if (errorPage) await markPageForRetry(errorPage.id, bookId, `Image generation failed: ${errorMsg}`, "Image generation error - scheduled for automatic retry");
      throw error;
    }

    console.log(`[Pipeline] Processing page ${pageNumber}: Saving to database...`);
    const page = await createPage({
      bookId, pageNumber, thumbnailFileKey: thumbnailKey, thumbnailUrl, ocrText,
      generatedPrompt: promptResult.prompt,
      generatedImageFileKey: generatedImageKey || undefined,
      generatedImageUrl: generatedImageUrl || undefined,
      processingStatus: "done",
    });

    // FIX: accumulate context so subsequent pages benefit from previous ones
    previousContexts.push({
      pageNumber,
      text: ocrText,
      prompt: promptResult.prompt,
      characters: extractCharactersFromText(ocrText),
      setting: promptResult.mood,
    });

    if (onProgress) onProgress({ bookId, totalPages: 0, processedPages: pageNumber, currentPage: pageNumber, status: "processing" });
    return page;
  } catch (error) {
    console.error(`[Pipeline] Error processing page ${pageNumber}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      const existingPages = await getBookPages(bookId);
      const existing = existingPages.find((p) => p.pageNumber === pageNumber);
      if (existing) { await updatePage(existing.id, { processingStatus: "error", errorMessage }); }
      else { await createPage({ bookId, pageNumber, processingStatus: "error", errorMessage }); }
    } catch (dbErr) { console.error(`[Pipeline] Failed to record error page ${pageNumber}:`, dbErr); }
    throw error;
  }
}

export async function processPagePipeline(
  bookId: number, pageNumber: number, pdfBuffer: Buffer,
  onProgress?: (progress: PipelineProgress) => void
): Promise<Page | null> {
  try {
    const thumbnailBuffer = await generatePageThumbnail(pdfBuffer, pageNumber, 1.0);
    const thumbnailKey = `books/${bookId}/pages/${pageNumber}/thumbnail.png`;
    const { url: thumbnailUrl } = await storagePut(thumbnailKey, thumbnailBuffer, "image/png");
    const ocrResult = await extractTextFromImage(thumbnailBuffer);
    const ocrText = ocrResult.text;
    const promptResult = await generateImagePrompt(ocrText, pageNumber, undefined, undefined);
    let generatedImageUrl: string | null = null;
    let generatedImageKey: string | null = null;
    try {
      const imageResult = await generateImage({ prompt: promptResult.prompt });
      if (imageResult.url) { generatedImageUrl = imageResult.url; generatedImageKey = `books/${bookId}/pages/${pageNumber}/generated.png`; }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorPage = await createPage({ bookId, pageNumber, thumbnailFileKey: thumbnailKey, thumbnailUrl, ocrText, generatedPrompt: promptResult.prompt, processingStatus: "error", errorMessage: `Image generation failed: ${errorMsg}` });
      if (errorPage) await markPageForRetry(errorPage.id, bookId, `Image generation failed: ${errorMsg}`, "Image generation error - scheduled for automatic retry");
      throw error;
    }
    const page = await createPage({ bookId, pageNumber, thumbnailFileKey: thumbnailKey, thumbnailUrl, ocrText, generatedPrompt: promptResult.prompt, generatedImageFileKey: generatedImageKey || undefined, generatedImageUrl: generatedImageUrl || undefined, processingStatus: "done" });
    if (onProgress) onProgress({ bookId, totalPages: 0, processedPages: pageNumber, currentPage: pageNumber, status: "processing" });
    return page;
  } catch (error) {
    console.error(`[Pipeline] Error processing page ${pageNumber}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      const existingPages = await getBookPages(bookId);
      const existing = existingPages.find((p) => p.pageNumber === pageNumber);
      if (existing) { await updatePage(existing.id, { processingStatus: "error", errorMessage }); }
      else { await createPage({ bookId, pageNumber, processingStatus: "error", errorMessage }); }
    } catch (dbErr) { console.error(`[Pipeline] Failed to record error page ${pageNumber}:`, dbErr); }
    throw error;
  }
}

/**
 * Process all pages of a PDF book through the pipeline with context awareness.
 *
 * FIX: Skips pages already in "done" state — makes retries safe.
 * FIX: Accumulates PageContext after each success for narrative continuity.
 * FIX: Sets book to "completed" if any pages succeeded; "failed" only if all failed.
 */
const MAX_PAGES = 20;

export async function processBookPipeline(
  bookId: number, pdfBuffer: Buffer,
  onProgress?: (progress: PipelineProgress) => void
): Promise<{ successCount: number; failureCount: number }> {
  let successCount = 0;
  let failureCount = 0;
  const pageContexts: PageContext[] = [];

  try {
    console.log(`[Pipeline] Starting book ${bookId} processing...`);
    const pdfData = await extractPDFPages(pdfBuffer);
    const totalPages = Math.min(pdfData.totalPages, MAX_PAGES);
    const ocrTexts = pdfData.pages.slice(0, totalPages).map((p) => p.text);
    console.log(`[Pipeline] Processing ${totalPages} pages (capped at MAX_PAGES=${MAX_PAGES})`);

    // FIX: load existing pages once so we can skip already-done ones on retries
    const existingPages = await getBookPages(bookId);
    const donePageNumbers = new Set(existingPages.filter((p) => p.processingStatus === "done").map((p) => p.pageNumber));
    if (donePageNumbers.size > 0) console.log(`[Pipeline] Skipping ${donePageNumbers.size} already-completed page(s)`);

    await updateBook(bookId, { processingStatus: "processing" });

    const storyContext = await buildStoryContext(ocrTexts).catch((err) => {
      console.error("[Pipeline] Story context build failed (continuing without it):", err);
      return null;
    });

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (donePageNumbers.has(pageNum)) {
        console.log(`[Pipeline] Page ${pageNum} already done — skipping`);
        successCount++;
        continue;
      }
      try {
        await processPagePipelineWithContext(bookId, pageNum, pdfBuffer, ocrTexts[pageNum - 1] || "", pageContexts, storyContext, onProgress);
        successCount++;
      } catch (error) {
        console.error(`[Pipeline] Failed to process page ${pageNum}:`, error);
        failureCount++;
      }
      if (onProgress) onProgress({ bookId, totalPages, processedPages: successCount, currentPage: pageNum, status: "processing" });
    }

    // FIX: only mark failed if ALL pages failed; completed if any succeeded
    const finalStatus = successCount > 0 ? "completed" : "failed";
    await updateBook(bookId, { processingStatus: finalStatus });
    if (failureCount > 0 && successCount > 0) console.warn(`[Pipeline] Book ${bookId} completed with ${failureCount} failed page(s). Use retryFailedPages to re-run them.`);
    if (onProgress) onProgress({ bookId, totalPages, processedPages: successCount, currentPage: totalPages, status: "completed" });

    return { successCount, failureCount };
  } catch (error) {
    console.error(`[Pipeline] Fatal error processing book ${bookId}:`, error);
    await updateBook(bookId, { processingStatus: "failed" });
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (onProgress) onProgress({ bookId, totalPages: 0, processedPages: 0, currentPage: 0, status: "failed", error: errorMessage });
    throw error;
  }
}
