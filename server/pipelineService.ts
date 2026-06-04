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
        // generateImage() already uploads to Cloudinary and returns the final URL
        // No need to fetch and re-upload
        generatedImageUrl = imageResult.url;
        generatedImageKey = `books/${bookId}/pages/${pageNumber}/generated.png`; // For reference
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Pipeline] Failed to generate image for page ${pageNumber}:`, errorMsg);
      
      // Mark page for retry with exponential backoff
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

    // Save error state to database
    const errorMessage = error instanceof Error ? error.message : String(error);
    await createPage({
      bookId,
      pageNumber,
      processingStatus: "error",
      errorMessage,
    });

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

    // Step 2: Extract text via OCR
    console.log(`[Pipeline] Processing page ${pageNumber}: Extracting text via OCR...`);
    const ocrResult = await extractTextFromImage(thumbnailBuffer);
    const ocrText = ocrResult.text;

    // Step 3: Generate prompt
    console.log(`[Pipeline] Processing page ${pageNumber}: Generating prompt...`);
    const promptResult = await generateImagePrompt(
      ocrText,
      pageNumber,
      undefined,
      undefined
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
        // generateImage() already uploads to Cloudinary and returns the final URL
        // No need to fetch and re-upload
        generatedImageUrl = imageResult.url;
        generatedImageKey = `books/${bookId}/pages/${pageNumber}/generated.png`; // For reference
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Pipeline] Failed to generate image for page ${pageNumber}:`, errorMsg);
      
      // Mark page for retry with exponential backoff
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

    // Save error state to database
    const errorMessage = error instanceof Error ? error.message : String(error);
    await createPage({
      bookId,
      pageNumber,
      processingStatus: "error",
      errorMessage,
    });

    throw error;
  }
}

/**
 * Process all pages of a PDF book through the pipeline with context awareness
 * Each page is processed with knowledge of previous pages for narrative continuity
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
    console.log(`[Pipeline] PDF buffer size: ${pdfBuffer.length} bytes`);
    
    // Extract PDF pages — cap at MAX_PAGES to keep processing fast and predictable
    console.log(`[Pipeline] Extracting PDF pages...`);
    const pdfData = await extractPDFPages(pdfBuffer);
    console.log(`[Pipeline] PDF extraction successful: ${pdfData.totalPages} pages found`);
    
    const totalPages = Math.min(pdfData.totalPages, MAX_PAGES);
    const ocrTexts = pdfData.pages.slice(0, totalPages).map((p) => p.text);
    console.log(`[Pipeline] Processing ${totalPages} pages (capped at MAX_PAGES=${MAX_PAGES})`);

    console.log(
      `[Pipeline] Starting processing for book ${bookId}: ${totalPages} pages (PDF has ${pdfData.totalPages})`
    );

    // Update book status to processing
    console.log(`[Pipeline] Updating book ${bookId} to processing status...`);
    await updateBook(bookId, { processingStatus: "processing" });
    console.log(`[Pipeline] Book ${bookId} status updated to processing`);

    // Build story context once from the opening pages so every illustration
    // uses the same art style, character descriptions, and setting.
    console.log(`[Pipeline] Building story context from opening pages...`);
    const storyContext = await buildStoryContext(ocrTexts).catch((err) => {
      console.error("[Pipeline] Story context build failed (continuing without it):", err);
      console.error("[Pipeline] Story context error stack:", err instanceof Error ? err.stack : 'No stack');
      return null;
    });
    console.log(`[Pipeline] Story context built: ${storyContext ? 'success' : 'failed, continuing without it'}`);

    // Process each page sequentially — storyContext is passed to every page
    // so the generated prompts stay visually consistent and in narrative order.
    console.log(`[Pipeline] Starting sequential page processing loop...`);
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        console.log(`[Pipeline] Processing page ${pageNum}/${totalPages}...`);
        await processPagePipelineWithContext(
          bookId,
          pageNum,
          pdfBuffer,
          ocrTexts[pageNum - 1] || "",
          pageContexts,
          storyContext,
          onProgress
        );
        console.log(`[Pipeline] Page ${pageNum} processed successfully`);
        successCount++;
      } catch (error) {
        console.error(`[Pipeline] Failed to process page ${pageNum}:`, error);
        console.error(`[Pipeline] Page ${pageNum} error stack:`, error instanceof Error ? error.stack : 'No stack');
        failureCount++;
      }

      // Report progress
      if (onProgress) {
        onProgress({
          bookId,
          totalPages,
          processedPages: successCount,
          currentPage: pageNum,
          status: "processing",
        });
      }
    }

    // Update book status to completed or failed
    const finalStatus = failureCount === 0 ? "completed" : "failed";
    console.log(`[Pipeline] Updating book ${bookId} to final status: ${finalStatus}`);
    await updateBook(bookId, { processingStatus: finalStatus });

    console.log(
      `[Pipeline] Completed context-aware processing for book ${bookId}: ${successCount} success, ${failureCount} failed`
    );
    console.log(`[Pipeline] Final status: ${finalStatus}`);

    if (onProgress) {
      onProgress({
        bookId,
        totalPages,
        processedPages: successCount,
        currentPage: totalPages,
        status: "completed",
      });
    }

    console.log(`[Pipeline] Processing complete for book ${bookId}. Returning: ${JSON.stringify({ successCount, failureCount })}`);
    return { successCount, failureCount };
  } catch (error) {
    console.error(`[Pipeline] Fatal error processing book ${bookId}:`, error);
    console.error(`[Pipeline] Error stack:", error instanceof Error ? error.stack : 'No stack trace');
    console.error(`[Pipeline] Error type:", typeof error);
    console.error(`[Pipeline] Error JSON:", JSON.stringify(error, null, 2));

    // Update book status to failed
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Pipeline] Updating book ${bookId} to failed status with message: ${errorMessage}`);
    await updateBook(bookId, {
      processingStatus: "failed",
    });

    if (onProgress) {
      onProgress({
        bookId,
        totalPages: 0,
        processedPages: 0,
        currentPage: 0,
        status: "failed",
        error: errorMessage,
      });
    }

    throw error;
  }
}
