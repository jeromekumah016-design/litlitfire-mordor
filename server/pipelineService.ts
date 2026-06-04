import { extractPDFPages, generatePageThumbnail } from "./pdfService";
import { extractTextFromImage } from "./ocrService";
import {
  generateImagePrompt,
  generateImagePromptsWithContext,
  buildStoryContext,
  generateStoryBible,
  transcribePage,
  type PageContext,
  type StoryContext,
  type StoryBible,
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
  getBook,
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

/**
 * Extract character names from text using simple heuristics
 */
function extractCharactersFromText(text: string): string[] {
  const characters: string[] = [];
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  const matches = text.match(namePattern) || [];

  const commonWords = new Set([
    "The",
    "And",
    "But",
    "For",
    "With",
    "From",
    "That",
    "This",
    "Which",
    "When",
    "Where",
    "Why",
    "How",
  ]);

  matches.forEach((match) => {
    if (!commonWords.has(match) && characters.length < 5) {
      characters.push(match);
    }
  });

  const uniqueCharacters: string[] = [];
  const seen = new Set<string>();
  for (const char of characters) {
    if (!seen.has(char)) {
      uniqueCharacters.push(char);
      seen.add(char);
    }
  }
  return uniqueCharacters;
}

/**
 * Process a single page with context awareness from previous pages
 */
async function processPagePipelineWithContext(
  bookId: number,
  pageNumber: number,
  pdfBuffer: Buffer,
  ocrText: string,
  previousContexts: PageContext[],
  storyContext: StoryContext | null,
  onProgress?: (progress: PipelineProgress) => void
): Promise<Page | null> {
  try {
    // Step 1: Extract thumbnail
    console.log(`[Pipeline] Processing page ${pageNumber}: Extracting thumbnail...`);
    const thumbnailBuffer = await generatePageThumbnail(pdfBuffer, pageNumber, 1.0);

    // Upload thumbnail to storage
    const thumbnailKey = `books/${bookId}/pages/${pageNumber}/thumbnail.png`;
    const { url: thumbnailUrl } = await storagePut(
      thumbnailKey,
      thumbnailBuffer,
      "image/png"
    );

    // Step 2: Use provided OCR text (already extracted from PDF)
    console.log(`[Pipeline] Processing page ${pageNumber}: Using OCR text...`);

    // Step 3: Generate prompt — uses locked-in story context for visual consistency
    console.log(`[Pipeline] Processing page ${pageNumber}: Generating prompt...`);
    const promptResult = await generateImagePrompt(
      ocrText,
      pageNumber,
      previousContexts.length > 0 ? previousContexts : undefined,
      storyContext
    );

    // Step 4: Generate image
    console.log(`[Pipeline] Processing page ${pageNumber}: Generating image...`);
    let generatedImageUrl: string | null = null;
    let generatedImageKey: string | null = null;

    try {
      const imageResult = await generateImage({
        prompt: promptResult.prompt,
      });

      if (imageResult.url) {
        generatedImageUrl = imageResult.url;
        generatedImageKey = `books/${bookId}/pages/${pageNumber}/generated.png`;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Pipeline] Failed to generate image for page ${pageNumber}:`, errorMsg);
      
      const errorPage = await createPage({
        bookId,
        pageNumber,
        thumbnailFileKey: thumbnailKey,
        thumbnailUrl,
        ocrText,
        generatedPrompt: promptResult.prompt,
        processingStatus: "error",
        errorMessage: `Image generation failed: ${errorMsg}`,
      });
      
      if (errorPage) {
        await markPageForRetry(
          errorPage.id,
          bookId,
          `Image generation failed: ${errorMsg}`,
          "Image generation error - scheduled for automatic retry"
        );
      }
      
      throw error;
    }

    // Step 5: Save to database
    console.log(`[Pipeline] Processing page ${pageNumber}: Saving to database...`);
    const page = await createPage({
      bookId,
      pageNumber,
      thumbnailFileKey: thumbnailKey,
      thumbnailUrl,
      ocrText,
      generatedPrompt: promptResult.prompt,
      generatedImageFileKey: generatedImageKey || undefined,
      generatedImageUrl: generatedImageUrl || undefined,
      processingStatus: "done",
    });

    if (onProgress) {
      onProgress({
        bookId,
        totalPages: 0,
        processedPages: pageNumber,
        currentPage: pageNumber,
        status: "processing",
      });
    }

    return page;
  } catch (error) {
    console.error(`[Pipeline] Error processing page ${pageNumber}:`, error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      const existingPages = await getBookPages(bookId);
      const existing = existingPages.find((p) => p.pageNumber === pageNumber);
      if (existing) {
        await updatePage(existing.id, { processingStatus: "error", errorMessage });
      } else {
        await createPage({ bookId, pageNumber, processingStatus: "error", errorMessage });
      }
    } catch (dbErr) {
      console.error(`[Pipeline] Failed to record error page ${pageNumber}:`, dbErr);
    }

    throw error;
  }
}

/**
 * Process a single page through the full pipeline (legacy, without context)
 */
export async function processPagePipeline(
  bookId: number,
  pageNumber: number,
  pdfBuffer: Buffer,
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
      if (imageResult.url) {
        generatedImageUrl = imageResult.url;
        generatedImageKey = `books/${bookId}/pages/${pageNumber}/generated.png`;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorPage = await createPage({ bookId, pageNumber, thumbnailFileKey: thumbnailKey, thumbnailUrl, ocrText, generatedPrompt: promptResult.prompt, processingStatus: "error", errorMessage: `Image generation failed: ${errorMsg}` });
      if (errorPage) await markPageForRetry(errorPage.id, bookId, `Image generation failed: ${errorMsg}`, "Image generation error");
      throw error;
    }

    const page = await createPage({ bookId, pageNumber, thumbnailFileKey: thumbnailKey, thumbnailUrl, ocrText, generatedPrompt: promptResult.prompt, generatedImageFileKey: generatedImageKey || undefined, generatedImageUrl: generatedImageUrl || undefined, processingStatus: "done" });
    return page;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      const existingPages = await getBookPages(bookId);
      const existing = existingPages.find((p) => p.pageNumber === pageNumber);
      if (existing) {
        await updatePage(existing.id, { processingStatus: "error", errorMessage });
      } else {
        await createPage({ bookId, pageNumber, processingStatus: "error", errorMessage });
      }
    } catch (dbErr) { console.error(dbErr); }
    throw error;
  }
}

/**
 * Process all pages of a PDF book through the pipeline with context awareness
 */
const MAX_PAGES = 20;

export async function processBookPipeline(
  bookId: number,
  pdfBuffer: Buffer,
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

    await updateBook(bookId, { processingStatus: "processing" });

    const storyContext = await buildStoryContext(ocrTexts).catch(() => null);

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        await processPagePipelineWithContext(bookId, pageNum, pdfBuffer, ocrTexts[pageNum - 1] || "", pageContexts, storyContext, onProgress);
        successCount++;
      } catch (error) {
        console.error(`[Pipeline] Failed to process page ${pageNum}:`, error);
        failureCount++;
      }
      if (onProgress) {
        onProgress({ bookId, totalPages, processedPages: successCount, currentPage: pageNum, status: "processing" });
      }
    }

    const finalStatus = failureCount === 0 ? "completed" : "failed";
    await updateBook(bookId, { processingStatus: finalStatus });
    return { successCount, failureCount };
  } catch (error) {
    await updateBook(bookId, { processingStatus: "failed" });
    throw error;
  }
}

// === NEW GATE FUNCTIONS (added on feat branch, keep old process* untouched as wrappers) ===

/**
 * generateStoryBible (step 1)
 */
export async function generateStoryBible(bookId: number): Promise<boolean> {
  const book = await getBook(bookId);
  if (!book) return false;
  const pages = await getBookPages(bookId);
  const texts = pages.map(p => p.ocrText || '').filter(Boolean);
  const bible = await generateStoryBible(texts); // promptService version (simple gate bible)
  if (bible) {
    await updateBook(bookId, { storyBible: bible as any });
    return true;
  }
  return false;
}

/**
 * transcribePages (step 2) - uses paraphrase + verbatim per spec
 */
export async function transcribePages(bookId: number): Promise<{ transcribed: number; skipped: number }> {
  const book = await getBook(bookId);
  if (!book) return { transcribed: 0, skipped: 0 };
  // Auto ensure bible if missing (makes Stage 1 button in UI sufficient)
  if (!book.storyBible) {
    await generateStoryBible(bookId);
  }
  const fresh = await getBook(bookId);
  const storyBible = (fresh?.storyBible || book.storyBible) as StoryBible || null;
  const pages = await getBookPages(bookId);
  let transcribed = 0; let skipped = 0;
  for (const p of pages) {
    if (p.promptStatus === 'prompt_ready') continue;
    await updatePage(p.id, { promptStatus: 'transcribing' });
    try {
      const res = await transcribePage(p.ocrText || '', p.pageNumber, storyBible);
      await updatePage(p.id, { promptStatus: 'prompt_ready', generatedPrompt: res.prompt, promptStructured: res.promptStructured, skipSuggested: res.skipSuggested });
      if (res.skipSuggested) skipped++; else transcribed++;
    } catch(e) {
      await updatePage(p.id, { promptStatus: 'prompt_error', errorMessage: String(e) });
    }
  }
  return { transcribed, skipped };
}

/**
 * renderApprovedImages (step 3) - DALL-E only on approved, reuse guards
 */
export async function renderApprovedImages(bookId: number): Promise<{ rendered: number }> {
  const pages = await getBookPages(bookId);
  let rendered = 0;
  for (const p of pages) {
    if (!p.promptApproved || p.generatedImageUrl || p.skipSuggested) continue;
    await updatePage(p.id, { imageStatus: 'generating' });
    try {
      const img = await generateImage({ prompt: p.generatedPrompt || 'book scene' });
      if (img.url) {
        await updatePage(p.id, { generatedImageUrl: img.url, imageStatus: 'image_ready', processingStatus: 'done' });
        rendered++;
      }
    } catch(e) {
      await updatePage(p.id, { imageStatus: 'image_error', errorMessage: String(e), processingStatus: 'error' });
    }
  }
  return { rendered };
}
