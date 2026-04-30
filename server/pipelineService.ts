import { extractPDFPages, generatePageThumbnail } from "./pdfService";
import { extractTextFromImage } from "./ocrService";
import { generateImagePrompt } from "./promptService";
import { generateImage } from "./_core/imageGeneration";
import { storagePut } from "./storage";
import {
  createPage,
  updatePage,
  createProcessingJob,
  updateProcessingJob,
  updateBook,
} from "./db";
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
 * Process a single page through the full pipeline:
 * 1. Extract thumbnail
 * 2. Extract text via OCR
 * 3. Generate prompt
 * 4. Generate image
 * 5. Upload to storage
 * 6. Save to database
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
    const { url: thumbnailUrl } = await storagePut(thumbnailKey, thumbnailBuffer, "image/png");

    // Step 2: Extract text via OCR
    console.log(`[Pipeline] Processing page ${pageNumber}: Extracting text via OCR...`);
    const ocrResult = await extractTextFromImage(thumbnailBuffer);
    const ocrText = ocrResult.text;

    // Step 3: Generate prompt
    console.log(`[Pipeline] Processing page ${pageNumber}: Generating prompt...`);
    const promptResult = await generateImagePrompt(ocrText, pageNumber);

    // Step 4: Generate image
    console.log(`[Pipeline] Processing page ${pageNumber}: Generating image...`);
    let generatedImageUrl: string | null = null;
    let generatedImageKey: string | null = null;

    try {
      const imageResult = await generateImage({
        prompt: promptResult.prompt,
      });

      if (imageResult.url) {
        // Download the generated image and upload to storage
        const response = await fetch(imageResult.url);
        const arrayBuffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);

        generatedImageKey = `books/${bookId}/pages/${pageNumber}/generated.png`;
        const uploadResult = await storagePut(generatedImageKey, imageBuffer, "image/png");
        generatedImageUrl = uploadResult.url;
      }
    } catch (error) {
      console.error(`[Pipeline] Failed to generate image for page ${pageNumber}:`, error);
      // Continue without generated image
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
 * Process all pages of a PDF book through the pipeline
 */
export async function processBookPipeline(
  bookId: number,
  pdfBuffer: Buffer,
  onProgress?: (progress: PipelineProgress) => void
): Promise<{ successCount: number; failureCount: number }> {
  let successCount = 0;
  let failureCount = 0;

  try {
    // Extract PDF pages to get total count
    const pdfData = await extractPDFPages(pdfBuffer);
    const totalPages = pdfData.totalPages;

    console.log(`[Pipeline] Starting processing for book ${bookId} with ${totalPages} pages`);

    // Update book status to processing
    await updateBook(bookId, { processingStatus: "processing" });

    // Process each page sequentially
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        await processPagePipeline(bookId, pageNum, pdfBuffer, onProgress);
        successCount++;
      } catch (error) {
        console.error(`[Pipeline] Failed to process page ${pageNum}:`, error);
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

    // Update book status to completed
    const finalStatus = failureCount === 0 ? "completed" : "completed";
    await updateBook(bookId, { processingStatus: finalStatus });

    console.log(
      `[Pipeline] Completed processing for book ${bookId}: ${successCount} success, ${failureCount} failed`
    );

    if (onProgress) {
      onProgress({
        bookId,
        totalPages,
        processedPages: successCount,
        currentPage: totalPages,
        status: "completed",
      });
    }

    return { successCount, failureCount };
  } catch (error) {
    console.error(`[Pipeline] Fatal error processing book ${bookId}:`, error);

    // Update book status to failed
    const errorMessage = error instanceof Error ? error.message : String(error);
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
