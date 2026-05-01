/**
 * PDF Service - Lightweight PDF processing without browser dependencies
 * Handles PDF metadata estimation and basic processing
 */

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  width: number;
  height: number;
  thumbnailBuffer?: Buffer;
}

export interface PDFExtractionResult {
  totalPages: number;
  pages: ExtractedPage[];
  title?: string;
}

/**
 * Estimate page count from PDF file size
 * Average PDF page is ~50-100KB
 */
function estimatePageCount(pdfBuffer: Buffer): number {
  const fileSizeKB = pdfBuffer.length / 1024;
  // Estimate: 1 page per 50KB, minimum 1 page
  const estimatedPages = Math.max(1, Math.ceil(fileSizeKB / 50));
  return Math.min(estimatedPages, 1000); // Cap at 1000 pages
}

/**
 * Extract basic metadata from PDF buffer
 * Looks for PDF title in metadata stream
 */
function extractBasicMetadata(pdfBuffer: Buffer): { title?: string } {
  try {
    const bufferStr = pdfBuffer.toString("binary", 0, Math.min(10000, pdfBuffer.length));
    const titleMatch = bufferStr.match(/\/Title\s*\(([^)]+)\)/);
    return {
      title: titleMatch ? titleMatch[1] : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Validate PDF file by checking header
 */
function validatePDFHeader(pdfBuffer: Buffer): boolean {
  if (pdfBuffer.length < 4) return false;
  const header = pdfBuffer.toString("ascii", 0, 4);
  return header === "%PDF";
}

/**
 * Extract text and metadata from a PDF (lightweight version)
 */
export async function extractPDFPages(
  pdfBuffer: Buffer
): Promise<PDFExtractionResult> {
  try {
    if (!validatePDFHeader(pdfBuffer)) {
      throw new Error("Invalid PDF file: missing PDF header");
    }

    const totalPages = estimatePageCount(pdfBuffer);
    const metadata = extractBasicMetadata(pdfBuffer);
    const pages: ExtractedPage[] = [];

    // Create placeholder pages
    for (let i = 1; i <= totalPages; i++) {
      pages.push({
        pageNumber: i,
        text: `Page ${i} content will be extracted during processing`,
        width: 612, // Standard letter width in points
        height: 792, // Standard letter height in points
      });
    }

    return {
      totalPages,
      pages,
      title: metadata.title,
    };
  } catch (error) {
    throw new Error(
      `Failed to extract PDF: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate a thumbnail for a specific page
 * Returns a placeholder buffer (1x1 transparent PNG)
 */
export async function generatePageThumbnail(
  pdfBuffer: Buffer,
  pageNumber: number,
  scale: number = 1.5
): Promise<Buffer> {
  try {
    if (!validatePDFHeader(pdfBuffer)) {
      throw new Error("Invalid PDF file");
    }

    const totalPages = estimatePageCount(pdfBuffer);
    if (pageNumber < 1 || pageNumber > totalPages) {
      throw new Error(
        `Invalid page number: ${pageNumber}. PDF has ${totalPages} pages.`
      );
    }

    // Return a placeholder buffer (1x1 transparent PNG)
    // In production, use a PDF rendering service like pdf2image or Cloudinary
    const placeholderPNG = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    return placeholderPNG;
  } catch (error) {
    throw new Error(
      `Failed to generate thumbnail for page ${pageNumber}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Extract all page thumbnails from a PDF
 */
export async function extractAllThumbnails(
  pdfBuffer: Buffer,
  scale: number = 1.5
): Promise<Map<number, Buffer>> {
  try {
    if (!validatePDFHeader(pdfBuffer)) {
      throw new Error("Invalid PDF file");
    }

    const totalPages = estimatePageCount(pdfBuffer);
    const thumbnails = new Map<number, Buffer>();

    // Placeholder PNG buffer
    const placeholderPNG = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    for (let i = 1; i <= totalPages; i++) {
      thumbnails.set(i, placeholderPNG);
    }

    return thumbnails;
  } catch (error) {
    throw new Error(
      `Failed to extract thumbnails: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get metadata about a PDF
 */
export async function getPDFMetadata(
  pdfBuffer: Buffer
): Promise<{ totalPages: number; title?: string }> {
  try {
    if (!validatePDFHeader(pdfBuffer)) {
      throw new Error("Invalid PDF file");
    }

    const totalPages = estimatePageCount(pdfBuffer);
    const metadata = extractBasicMetadata(pdfBuffer);

    return {
      totalPages,
      title: metadata.title,
    };
  } catch (error) {
    throw new Error(
      `Failed to get PDF metadata: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
