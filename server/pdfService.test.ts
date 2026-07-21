import { describe, it, expect, beforeAll } from "vitest";
import { extractPDFPages, getPDFMetadata, extractSinglePageText } from "./pdfService";

/**
 * Create a minimal valid PDF buffer for testing
 */
function createTestPDFBuffer(): Buffer {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT
/F1 12 Tf
100 700 Td
(Hello World) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000337 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
417
%%EOF`;

  return Buffer.from(pdfContent, "utf-8");
}

describe("pdfService", () => {
  let testPDFBuffer: Buffer;

  beforeAll(() => {
    testPDFBuffer = createTestPDFBuffer();
  });

  describe("extractPDFPages", () => {
    it("should extract pages from a valid PDF", async () => {
      const result = await extractPDFPages(testPDFBuffer);

      expect(result).toBeDefined();
      expect(result.totalPages).toBeGreaterThan(0);
      expect(Array.isArray(result.pages)).toBe(true);
      expect(result.pages.length).toBe(result.totalPages);
    });

    it("should extract page metadata", async () => {
      const result = await extractPDFPages(testPDFBuffer);

      result.pages.forEach((page) => {
        expect(page.pageNumber).toBeGreaterThan(0);
        expect(typeof page.text).toBe("string");
        expect(typeof page.width).toBe("number");
        expect(typeof page.height).toBe("number");
        expect(page.width).toBeGreaterThan(0);
        expect(page.height).toBeGreaterThan(0);
      });
    });

    it("should handle invalid PDF buffer", async () => {
      const invalidBuffer = Buffer.from("not a pdf");

      await expect(extractPDFPages(invalidBuffer)).rejects.toThrow();
    });

    it("should handle empty buffer", async () => {
      const emptyBuffer = Buffer.alloc(0);

      await expect(extractPDFPages(emptyBuffer)).rejects.toThrow();
    });

    it("should extract text content from pages", async () => {
      const result = await extractPDFPages(testPDFBuffer);

      // Pages should have text or be empty (both valid)
      expect(result.pages.length).toBeGreaterThan(0);
      result.pages.forEach((page) => {
        expect(typeof page.text).toBe("string");
      });
    });

    it("should extract same data on multiple calls", async () => {
      const result1 = await extractPDFPages(testPDFBuffer);
      const result2 = await extractPDFPages(testPDFBuffer);

      expect(result1.totalPages).toBe(result2.totalPages);
      expect(result1.pages.length).toBe(result2.pages.length);

      result1.pages.forEach((page, idx) => {
        expect(page.pageNumber).toBe(result2.pages[idx].pageNumber);
        expect(page.width).toBe(result2.pages[idx].width);
        expect(page.height).toBe(result2.pages[idx].height);
      });
    });
  });

  describe("extractSinglePageText", () => {
    it("extracts the same text extractPDFPages reports for that page", async () => {
      const fromBatch = await extractPDFPages(testPDFBuffer);
      const single = await extractSinglePageText(testPDFBuffer, 1);

      expect(single).toBe(fromBatch.pages[0].text);
    });

    it("returns a string containing the page's real text content", async () => {
      const single = await extractSinglePageText(testPDFBuffer, 1);

      // The fixture's content stream renders the literal string "Hello World".
      expect(single).toContain("Hello World");
    });

    it("throws for a page number below 1", async () => {
      await expect(extractSinglePageText(testPDFBuffer, 0)).rejects.toThrow(
        /Invalid page number/
      );
    });

    it("throws for a page number beyond the document's page count", async () => {
      await expect(extractSinglePageText(testPDFBuffer, 999)).rejects.toThrow(
        /Invalid page number/
      );
    });

    it("throws for an invalid PDF buffer", async () => {
      const invalidBuffer = Buffer.from("not a pdf");

      await expect(extractSinglePageText(invalidBuffer, 1)).rejects.toThrow();
    });

    it("returns consistent text across multiple calls", async () => {
      const first = await extractSinglePageText(testPDFBuffer, 1);
      const second = await extractSinglePageText(testPDFBuffer, 1);

      expect(first).toBe(second);
    });
  });

  describe("getPDFMetadata", () => {
    it("should extract PDF metadata", async () => {
      const metadata = await getPDFMetadata(testPDFBuffer);

      expect(metadata).toBeDefined();
      expect(metadata.totalPages).toBeGreaterThan(0);
      expect(typeof metadata.totalPages).toBe("number");
    });

    it("should handle PDFs without title", async () => {
      const metadata = await getPDFMetadata(testPDFBuffer);

      expect(metadata).toBeDefined();
      expect(metadata.totalPages).toBeGreaterThan(0);
    });

    it("should throw for invalid PDF", async () => {
      const invalidBuffer = Buffer.from("not a pdf");

      await expect(getPDFMetadata(invalidBuffer)).rejects.toThrow();
    });

    it("should return consistent metadata", async () => {
      const metadata1 = await getPDFMetadata(testPDFBuffer);
      const metadata2 = await getPDFMetadata(testPDFBuffer);

      expect(metadata1.totalPages).toBe(metadata2.totalPages);
    });
  });
});
