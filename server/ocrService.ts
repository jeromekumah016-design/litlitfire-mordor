import Tesseract from "tesseract.js";
import { withRetry } from "./resilience";

export interface OCRResult {
  text: string;
  confidence: number;
  language: string;
}

/**
 * Number of in-process attempts for a single OCR call before giving up. This
 * is deliberately separate from — and smaller than — the DB-backed page-level
 * retry scheduling in retryService.ts (markPageForRetry/getPagesReadyForRetry).
 * That layer handles a page that has definitively failed and needs a
 * backoff-scheduled re-run of the whole pipeline step, possibly much later.
 * This layer just absorbs a transient hiccup (e.g. a flaky Tesseract worker
 * spin-up) within the same call so a single blip doesn't bounce the page all
 * the way out to the outer error/retry path.
 */
const OCR_MAX_RETRIES = 2;
const OCR_INITIAL_DELAY_MS = 250;

/**
 * Extract text from an image buffer using Tesseract OCR
 */
export async function extractTextFromImage(imageBuffer: Buffer, language: string = "eng"): Promise<OCRResult> {
  try {
    return await withRetry(
      async () => {
        const result = await Tesseract.recognize(imageBuffer, language, {
          logger: (m) => {
            if (m.status === "recognizing text") {
              console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
            }
          },
        });

        return {
          text: result.data.text,
          confidence: result.data.confidence,
          language: result.data.psm || language,
        };
      },
      OCR_MAX_RETRIES,
      OCR_INITIAL_DELAY_MS
    );
  } catch (error) {
    console.error("Error performing OCR:", error);
    throw new Error(`OCR failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Extract text from multiple images
 */
export async function extractTextFromImages(
  imageBuffers: Buffer[],
  language: string = "eng"
): Promise<OCRResult[]> {
  const results: OCRResult[] = [];

  for (let i = 0; i < imageBuffers.length; i++) {
    try {
      const result = await extractTextFromImage(imageBuffers[i], language);
      results.push(result);
    } catch (error) {
      console.error(`Error extracting text from image ${i}:`, error);
      results.push({
        text: "",
        confidence: 0,
        language,
      });
    }
  }

  return results;
}

/**
 * Terminate Tesseract worker (cleanup)
 */
export async function terminateOCRWorker(): Promise<void> {
  try {
    // Tesseract.js handles worker cleanup automatically
    // This is a placeholder for future cleanup logic
    console.log("OCR worker cleanup called");
  } catch (error) {
    console.error("Error terminating OCR worker:", error);
  }
}
