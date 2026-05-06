#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const PDF_PATH = '/home/ubuntu/upload/HuckFinn.pdf';
const POLL_INTERVAL = 2000; // 2 seconds
const MAX_WAIT_TIME = 300000; // 5 minutes

// Mock user context (in real scenario, would use actual auth)
const MOCK_USER_ID = 1;
const MOCK_USER_TOKEN = 'test-token';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function uploadPDF() {
  console.log('\n📤 STEP 1: Uploading PDF...');
  
  try {
    const pdfBuffer = fs.readFileSync(PDF_PATH);
    const base64Data = pdfBuffer.toString('base64');
    
    console.log(`   - PDF size: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   - Base64 size: ${(base64Data.length / 1024).toFixed(2)} KB`);
    
    const response = await fetch(`${API_BASE}/api/trpc/books.upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        '0': {
          json: {
            title: 'Huckleberry Finn - Diagnostic Test',
            description: 'Full diagnostic test of PDF processing pipeline',
            pdfData: base64Data,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('   ✓ Upload response received');
    
    // Extract book ID from tRPC response
    const bookData = data[0];
    if (bookData.error) {
      throw new Error(`Upload error: ${bookData.error.message}`);
    }
    
    const bookId = bookData.result.data.bookId;
    console.log(`   ✓ Book created with ID: ${bookId}`);
    console.log(`   ✓ Status: ${bookData.result.data.processingStatus}`);
    console.log(`   ✓ Page count: ${bookData.result.data.pageCount}`);
    console.log(`   ✓ Total price: $${bookData.result.data.totalPrice}`);
    
    return bookId;
  } catch (error) {
    console.error('   ✗ Upload failed:', error.message);
    throw error;
  }
}

async function monitorProcessing(bookId) {
  console.log('\n📊 STEP 2: Monitoring Processing Pipeline...');
  
  const startTime = Date.now();
  let lastStats = null;
  let pollCount = 0;
  
  while (Date.now() - startTime < MAX_WAIT_TIME) {
    pollCount++;
    
    try {
      const response = await fetch(`${API_BASE}/api/trpc/books.getDetails?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22bookId%22%3A${bookId}%7D%7D%7D`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const bookData = data[0].result.data;
      
      // Calculate stats
      const pages = bookData.pages || [];
      const stats = {
        total: bookData.pageCount,
        pending: pages.filter(p => p.processingStatus === 'pending').length,
        processing: pages.filter(p => p.processingStatus === 'processing').length,
        done: pages.filter(p => p.processingStatus === 'done').length,
        error: pages.filter(p => p.processingStatus === 'error').length,
      };
      
      // Print progress if changed
      if (!lastStats || JSON.stringify(stats) !== JSON.stringify(lastStats)) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const progress = ((stats.done / stats.total) * 100).toFixed(1);
        console.log(`   [${elapsed}s] Progress: ${stats.done}/${stats.total} (${progress}%) | Pending: ${stats.pending} | Processing: ${stats.processing} | Errors: ${stats.error}`);
        lastStats = stats;
      }
      
      // Check if processing is complete
      if (stats.done === stats.total) {
        console.log('\n   ✓ Processing complete!');
        return { success: true, stats, pages };
      }
      
      // Check for errors
      if (stats.error > 0) {
        console.log(`\n   ⚠ Warning: ${stats.error} pages failed processing`);
      }
      
    } catch (error) {
      console.error(`   ✗ Poll failed: ${error.message}`);
    }
    
    // Wait before next poll
    await delay(POLL_INTERVAL);
  }
  
  console.log(`\n   ✗ Timeout after ${(MAX_WAIT_TIME / 1000).toFixed(0)} seconds`);
  return { success: false, timeout: true };
}

async function analyzeResults(bookId, pages) {
  console.log('\n📈 STEP 3: Analyzing Results...');
  
  if (!pages || pages.length === 0) {
    console.log('   ✗ No pages processed');
    return;
  }
  
  console.log(`\n   Total pages processed: ${pages.length}`);
  
  // Sample first 3 pages
  const samplePages = pages.slice(0, 3);
  
  samplePages.forEach((page, idx) => {
    console.log(`\n   Page ${page.pageNumber}:`);
    console.log(`     - Status: ${page.processingStatus}`);
    console.log(`     - OCR text: ${page.ocrText ? page.ocrText.substring(0, 60) + '...' : 'N/A'}`);
    console.log(`     - Prompt: ${page.generatedPrompt ? page.generatedPrompt.substring(0, 60) + '...' : 'N/A'}`);
    console.log(`     - Image URL: ${page.generatedImageUrl ? '✓ Generated' : '✗ Not generated'}`);
    console.log(`     - Thumbnail: ${page.thumbnailUrl ? '✓ Available' : '✗ Not available'}`);
    if (page.errorMessage) {
      console.log(`     - Error: ${page.errorMessage}`);
    }
  });
  
  // Summary
  const completedPages = pages.filter(p => p.processingStatus === 'done').length;
  const pagesWithImages = pages.filter(p => p.generatedImageUrl).length;
  const pagesWithOCR = pages.filter(p => p.ocrText).length;
  
  console.log(`\n   Summary:`);
  console.log(`     - Completed: ${completedPages}/${pages.length}`);
  console.log(`     - With images: ${pagesWithImages}/${pages.length}`);
  console.log(`     - With OCR text: ${pagesWithOCR}/${pages.length}`);
}

async function runDiagnostic() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔍 LiteralLiterature PDF Processing Diagnostic');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`API Base: ${API_BASE}`);
  console.log(`PDF: ${PDF_PATH}`);
  console.log(`Start time: ${new Date().toISOString()}`);
  
  try {
    // Step 1: Upload
    const bookId = await uploadPDF();
    
    // Step 2: Monitor
    const result = await monitorProcessing(bookId);
    
    if (result.success) {
      // Step 3: Analyze
      await analyzeResults(bookId, result.pages);
      
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('✅ DIAGNOSTIC COMPLETE - All systems operational!');
      console.log('═══════════════════════════════════════════════════════════\n');
    } else {
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('⚠ DIAGNOSTIC INCOMPLETE - Processing timeout');
      console.log('═══════════════════════════════════════════════════════════\n');
    }
    
  } catch (error) {
    console.error('\n❌ DIAGNOSTIC FAILED:', error.message);
    console.log('═══════════════════════════════════════════════════════════\n');
    process.exit(1);
  }
}

// Run diagnostic
runDiagnostic();
