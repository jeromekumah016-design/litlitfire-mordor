import Tesseract from "tesseract.js";

export interface OCRResult {
  text: string;
  confidence: number;
  language: string;
}

/**
 * Extract text from an image buffer using Tesseract OCR
 */
export async function extractTextFromImage(imageBuffer: Buffer, language: string = "eng"): Promise<OCRResult> {
  try {
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
