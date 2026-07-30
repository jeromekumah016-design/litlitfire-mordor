/**
 * Autonomous two-phase offline pipeline loop (functional bar)
 * ===========================================================
 *
 * upload/extract → transcribe (storyBible + prompts) → approve all →
 * renderApprovedImages → verify real storage keys + image URLs.
 *
 * OFFLINE_MODE forced (zero paid spend) unless OFFLINE_MODE=false and keys set.
 *
 *   pnpm loop
 *
 * Exit: 0 ok · 1 no images · 2 misconfig · 3 error
 */

import "dotenv/config";

if (process.env.OFFLINE_MODE !== "false") {
  process.env.OFFLINE_MODE = "true";
}
process.env.RETRY_WORKER_ENABLED = process.env.RETRY_WORKER_ENABLED ?? "false";
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  process.env.JWT_SECRET = "dev-offline-autonomous-loop-secret-32b";
}

function fail(code: number, msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(code);
}

function buildMultiPagePdf(pageTexts: string[]): Buffer {
  const objects: string[] = [];
  let objNum = 1;
  const catalogNum = objNum++;
  const pagesNum = objNum++;
  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];
  const fontNum = objNum++;
  for (let i = 0; i < pageTexts.length; i++) {
    pageObjNums.push(objNum++);
    contentObjNums.push(objNum++);
  }
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  objects.push(`${catalogNum} 0 obj\n<< /Type /Catalog /Pages ${pagesNum} 0 R >>\nendobj\n`);
  objects.push(
    `${pagesNum} 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageTexts.length} >>\nendobj\n`
  );
  objects.push(
    `${fontNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`
  );

  for (let i = 0; i < pageTexts.length; i++) {
    const pageN = pageObjNums[i];
    const contentN = contentObjNums[i];
    const words = pageTexts[i].split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length > 70) {
        lines.push(line.trim());
        line = w;
      } else line = (line + " " + w).trim();
    }
    if (line) lines.push(line);
    const streamBody =
      "BT\n/F1 12 Tf\n50 750 Td\n14 TL\n" +
      lines.map((l, idx) => (idx === 0 ? `(${esc(l)}) Tj\n` : `T*\n(${esc(l)}) Tj\n`)).join("") +
      "ET\n";
    const stream = `<< /Length ${Buffer.byteLength(streamBody, "utf8")} >>\nstream\n${streamBody}endstream\n`;
    objects.push(
      `${pageN} 0 obj\n<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] /Contents ${contentN} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>\nendobj\n`
    );
    objects.push(`${contentN} 0 obj\n${stream}endobj\n`);
  }

  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    body += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Two-phase autonomous loop: extract → transcribe → approve → render");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  OFFLINE_MODE=${process.env.OFFLINE_MODE}`);
  console.log(`  DATABASE_URL=${process.env.DATABASE_URL ? "(set)" : "(missing)"}`);

  if (!process.env.DATABASE_URL) {
    fail(
      2,
      "DATABASE_URL required. Set in .env, run `pnpm db:push`, then `pnpm loop`."
    );
  }

  const { upsertUser, getUserByOpenId, createBook, getBook, getBookPages, getDb } =
    await import("../server/db");
  const { extractAndStorePages, transcribeBook, setPagePromptApproval, renderApprovedImages } =
    await import("../server/gatePipeline");
  const { storagePut } = await import("../server/storage");
  const { calculatePrice } = await import("../server/pricingService");
  const { isLLMOffline, isImageOffline, isStorageOffline } = await import(
    "../server/_core/offline"
  );

  console.log(
    `  offline: llm=${isLLMOffline()} image=${isImageOffline()} storage=${isStorageOffline()}`
  );

  if (!(await getDb())) fail(2, "Database unavailable");

  await upsertUser({
    openId: "demo_offline_user",
    name: "Demo User",
    email: "demo@local.dev",
    loginMethod: "demo",
    lastSignedIn: new Date(),
  });
  const user = await getUserByOpenId("demo_offline_user");
  if (!user) fail(2, "Demo user missing");

  const pageTexts = [
    "Chapter One. In a quiet riverside town, young Mara watched the morning mist rise over the oak bridge while the baker lit his oven for the day.",
    "Chapter Two. Captain Ellis arrived with a weathered map and a story of a lost compass that always pointed toward home rather than north.",
    "Chapter Three. Together they crossed the bridge at dusk, lantern light catching gold on the water, determined to find the compass before winter.",
  ];
  const pdfBuffer = buildMultiPagePdf(pageTexts);
  const stamp = Date.now();
  const pdfKey = `books/${user.id}/loop-${stamp}.pdf`;
  const { url: pdfUrl } = await storagePut(pdfKey, pdfBuffer, "application/pdf");

  const book = await createBook({
    userId: user.id,
    title: `Two-phase Loop ${stamp}`,
    description: "Functional bar autonomous loop",
    pdfFileKey: pdfKey,
    pdfFileUrl: pdfUrl,
    pageCount: pageTexts.length,
    processingStatus: "pending",
    totalPrice: calculatePrice(pageTexts.length).toString(),
  });
  if (!book) fail(2, "createBook failed");

  console.log(`\n① Extract/OCR book #${book.id}…`);
  const ex = await extractAndStorePages(book.id, pdfBuffer);
  console.log(`   extracted=${ex.extracted}`);

  console.log("② Transcribe (storyBible + prompts)…");
  const tr = await transcribeBook(book.id);
  console.log(
    `   transcribed=${tr.transcribed} errors=${tr.errors} biblePersisted=${tr.biblePersisted}`
  );

  const pagesAfter = await getBookPages(book.id);
  console.log("③ Approve all prompt_ready pages…");
  for (const p of pagesAfter) {
    if (p.promptStatus === "prompt_ready") {
      await setPagePromptApproval(p.id, true);
      console.log(`   approved page ${p.pageNumber}`);
    } else {
      console.log(`   skip page ${p.pageNumber} status=${p.promptStatus}`);
    }
  }

  console.log("④ Render approved only (records real keys)…");
  const rr = await renderApprovedImages(book.id);
  console.log(`   rendered=${rr.rendered} skipped=${rr.skipped} errors=${rr.errors}`);

  const finalPages = await getBookPages(book.id);
  const fresh = await getBook(book.id);
  console.log("───────────────────────────────────────────────────────────");
  console.log(`  bookStatus=${fresh?.processingStatus} storyBible=${!!(fresh as any)?.storyBible}`);
  for (const p of finalPages) {
    console.log(
      `  p${p.pageNumber} prompt=${p.promptStatus} image=${p.imageStatus} key=${p.generatedImageFileKey ?? "—"} url=${p.generatedImageUrl ? "yes" : "no"}`
    );
  }
  console.log("───────────────────────────────────────────────────────────");

  const ok = finalPages.filter(
    (p) =>
      p.imageStatus === "image_ready" &&
      p.generatedImageUrl &&
      p.generatedImageFileKey &&
      p.generatedImageFileKey.startsWith(`books/${book.id}/`)
  );
  if (ok.length === 0) {
    fail(1, "No pages with image_ready + real book-scoped storage key");
  }

  console.log(`\n✅ Functional bar met offline: ${ok.length} photo(s) with real keys.\n`);
  console.log("   For a LIVE DALL·E run: OFFLINE_MODE=false OPENAI_API_KEY=sk-... (+ storage keys) pnpm loop\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
