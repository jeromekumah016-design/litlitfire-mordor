#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import services directly
const { getDb } = await import('./server/db.ts');
const { processBookPipeline } = await import('./server/pipelineService.ts');

const PDF_PATH = '/home/ubuntu/upload/HuckFinn.pdf';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBackendDiagnostic() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔍 LiteralLiterature Backend PDF Processing Diagnostic');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`PDF: ${PDF_PATH}`);
  console.log(`Start time: ${new Date().toISOString()}`);
  
  try {
    // Step 1: Load PDF
    console.log('\n📤 STEP 1: Loading PDF...');
    const pdfBuffer = fs.readFileSync(PDF_PATH);
    console.log(`   ✓ PDF loaded: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
    
    // Step 2: Create book record
    console.log('\n📝 STEP 2: Creating book record...');
    const db = await getDb();
    
    if (!db) {
      throw new Error('Database not available');
    }
    
    const bookResult = await db.insert(books).values({
      userId: 1, // Mock user
      title: 'Huckleberry Finn - Backend Diagnostic',
      description: 'Full diagnostic test of PDF processing pipeline',
      pdfUrl: '/manus-storage/huckfinn-diagnostic.pdf',
      pdfFileKey: 'huckfinn-diagnostic.pdf',
      pageCount: 17,
      processingStatus: 'processing',
      totalPrice: 17 * 0.50, // $0.50 per page
    });
    
    const bookId = bookResult.insertId;
    console.log(`   ✓ Book created with ID: ${bookId}`);
    
    // Step 3: Start processing
    console.log('\n⚙️  STEP 3: Starting PDF processing pipeline...');
    
    try {
      await processBookPipeline(bookId, pdfBuffer);
      console.log('   ✓ Pipeline started (running in background)');
    } catch (error) {
      console.log(`   ⚠ Pipeline error: ${error.message}`);
    }
    
    // Step 4: Monitor processing
    console.log('\n📊 STEP 4: Monitoring processing progress...');
    
    const maxWaitTime = 300000; // 5 minutes
    const startTime = Date.now();
    let lastStats = null;
    
    while (Date.now() - startTime < maxWaitTime) {
      const bookData = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
      const book = bookData[0];
      
      const pages = await db.select().from(pages).where(eq(pages.bookId, bookId));
      
      const stats = {
        total: book.pageCount,
        pending: pages.filter(p => p.processingStatus === 'pending').length,
        processing: pages.filter(p => p.processingStatus === 'processing').length,
        done: pages.filter(p => p.processingStatus === 'done').length,
        error: pages.filter(p => p.processingStatus === 'error').length,
      };
      
      if (!lastStats || JSON.stringify(stats) !== JSON.stringify(lastStats)) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const progress = stats.total > 0 ? ((stats.done / stats.total) * 100).toFixed(1) : 0;
        console.log(`   [${elapsed}s] Progress: ${stats.done}/${stats.total} (${progress}%) | Pending: ${stats.pending} | Processing: ${stats.processing} | Errors: ${stats.error}`);
        lastStats = stats;
      }
      
      if (stats.done === stats.total) {
        console.log('\n   ✓ Processing complete!');
        
        // Step 5: Analyze results
        console.log('\n📈 STEP 5: Analyzing results...');
        console.log(`\n   Total pages processed: ${pages.length}`);
        
        const samplePages = pages.slice(0, 3);
        samplePages.forEach((page) => {
          console.log(`\n   Page ${page.pageNumber}:`);
          console.log(`     - Status: ${page.processingStatus}`);
          console.log(`     - OCR text: ${page.ocrText ? page.ocrText.substring(0, 60) + '...' : 'N/A'}`);
          console.log(`     - Prompt: ${page.generatedPrompt ? page.generatedPrompt.substring(0, 60) + '...' : 'N/A'}`);
          console.log(`     - Image URL: ${page.generatedImageUrl ? '✓ Generated' : '✗ Not generated'}`);
          if (page.errorMessage) {
            console.log(`     - Error: ${page.errorMessage}`);
          }
        });
        
        const pagesWithImages = pages.filter(p => p.generatedImageUrl).length;
        const pagesWithOCR = pages.filter(p => p.ocrText).length;
        
        console.log(`\n   Summary:`);
        console.log(`     - Completed: ${stats.done}/${stats.total}`);
        console.log(`     - With images: ${pagesWithImages}/${stats.total}`);
        console.log(`     - With OCR text: ${pagesWithOCR}/${stats.total}`);
        
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('✅ DIAGNOSTIC COMPLETE - All systems operational!');
        console.log('═══════════════════════════════════════════════════════════\n');
        break;
      }
      
      await delay(2000);
    }
    
  } catch (error) {
    console.error('\n❌ DIAGNOSTIC FAILED:', error.message);
    console.error(error.stack);
    console.log('═══════════════════════════════════════════════════════════\n');
    process.exit(1);
  }
}

// Run diagnostic
runBackendDiagnostic();
