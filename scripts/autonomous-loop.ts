/**
 * Autonomous offline pipeline loop
 * =================================
 *
 * Runs the full book → extract → prompt → image loop with ZERO paid API spend:
 *   OFFLINE_MODE (or missing keys) → LLM stubs + SVG placeholders + local storage.
 *
 * Requires:
 *   - DATABASE_URL pointing at Postgres (schema applied via `pnpm db:push`)
 *   - JWT_SECRET (≥16 chars) only if you also exercise HTTP demo login
 *
 * Usage:
 *   pnpm loop
 *   # or
 *   OFFLINE_MODE=true DATABASE_URL=... pnpm exec tsx scripts/autonomous-loop.ts
 *
 * Exit codes:
 *   0  success (at least one page/scene done with an image URL)
 *   1  pipeline ran but produced no usable images
 *   2  misconfigured env / DB unavailable
 *   3  unexpected error
 */

import "dotenv/config";

// Force offline stubs before any server module reads ENV.
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
  // Minimal multi-page PDF 1.4 with Helvetica text per page (pdfjs can extract).
  const objects: string[] = [];
  const kids: string[] = [];
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

  // Escape PDF string literals
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
    // Wrap long text into a few Tj lines
    const words = pageTexts[i].split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length > 70) {
        lines.push(line.trim());
        line = w;
      } else {
        line = (line + " " + w).trim();
      }
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
  console.log("  LiteralLiterature — autonomous offline pipeline loop");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  OFFLINE_MODE=${process.env.OFFLINE_MODE}`);
  console.log(`  DATABASE_URL=${process.env.DATABASE_URL ? "(set)" : "(missing)"}`);

  if (!process.env.DATABASE_URL) {
    fail(
      2,
      "DATABASE_URL is required. Create a Neon/local Postgres DB, set it in .env, run `pnpm db:push`, then re-run `pnpm loop`."
    );
  }

  // Dynamic imports after env is set so ENV.offlineMode is true.
  const { upsertUser, getUserByOpenId, createBook, getBook, getBookPages, getBookScenes } =
    await import("../server/db");
  const { processBookPipeline } = await import("../server/pipelineService");
  const { storagePut } = await import("../server/storage");
  const { calculatePrice } = await import("../server/pricingService");
  const { getDb } = await import("../server/db");
  const { isLLMOffline, isImageOffline, isStorageOffline } = await import(
    "../server/_core/offline"
  );

  console.log(
    `  offline boundaries: llm=${isLLMOffline()} image=${isImageOffline()} storage=${isStorageOffline()}`
  );

  const db = await getDb();
  if (!db) fail(2, "Could not connect to database (getDb returned null).");

  const openId = "demo_offline_user";
  await upsertUser({
    openId,
    name: "Demo User",
    email: "demo@local.dev",
    loginMethod: "demo",
    lastSignedIn: new Date(),
  });
  const user = await getUserByOpenId(openId);
  if (!user) fail(2, "Failed to upsert/load demo user.");

  const pageTexts = [
    "Chapter One. In a quiet riverside town, young Mara watched the morning mist rise over the oak bridge while the baker lit his oven.",
    "Chapter Two. Captain Ellis arrived with a weathered map and a story of a lost compass that always pointed toward home rather than north.",
    "Chapter Three. Together they crossed the bridge at dusk, lantern light catching gold on the water, determined to find the compass before winter.",
  ];
  const pdfBuffer = buildMultiPagePdf(pageTexts);
  console.log(`\n📄 Built synthetic PDF: ${pageTexts.length} pages, ${pdfBuffer.length} bytes`);

  const stamp = Date.now();
  const title = `Autonomous Loop ${stamp}`;
  const pdfKey = `books/${user.id}/loop-${stamp}.pdf`;
  const { url: pdfUrl } = await storagePut(pdfKey, pdfBuffer, "application/pdf");
  const totalPrice = calculatePrice(pageTexts.length).toString();

  const book = await createBook({
    userId: user.id,
    title,
    description: "Autonomous offline loop smoke book",
    pdfFileKey: pdfKey,
    pdfFileUrl: pdfUrl,
    pageCount: pageTexts.length,
    processingStatus: "pending",
    totalPrice,
  });
  if (!book) fail(2, "createBook returned null — schema/DB issue?");

  console.log(`📚 Book #${book.id} created (user ${user.id})`);
  console.log("⚙️  Running processBookPipeline (offline stubs)...\n");

  const t0 = Date.now();
  let pipelineResult: { successCount: number; failureCount: number };
  try {
    pipelineResult = await processBookPipeline(book.id, pdfBuffer);
  } catch (err) {
    console.error(err);
    fail(3, `processBookPipeline threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const fresh = await getBook(book.id);
  const pages = await getBookPages(book.id);
  const scenes = await getBookScenes(book.id);
  const mode = (fresh as { generationMode?: string } | null)?.generationMode ?? "page";

  const imageRows =
    mode === "scene"
      ? scenes.map((s) => ({
          n: s.sceneIndex + 1,
          status: s.processingStatus,
          prompt: s.prompt?.slice(0, 80),
          image: s.generatedImageUrl,
        }))
      : pages.map((p) => ({
          n: p.pageNumber,
          status: p.processingStatus,
          prompt: p.generatedPrompt?.slice(0, 80),
          image: p.generatedImageUrl,
        }));

  console.log("───────────────────────────────────────────────────────────");
  console.log(`  mode=${mode}  bookStatus=${fresh?.processingStatus}`);
  console.log(
    `  pipeline: success=${pipelineResult.successCount} failure=${pipelineResult.failureCount}  (${elapsed}s)`
  );
  for (const row of imageRows) {
    console.log(
      `  #${row.n} status=${row.status} image=${row.image ? "yes" : "no"} prompt=${row.prompt ?? "(none)"}…`
    );
  }
  console.log("───────────────────────────────────────────────────────────");

  const doneWithImage = imageRows.filter((r) => r.status === "done" && r.image).length;
  if (doneWithImage === 0) {
    fail(
      1,
      `Loop finished but no rendered images (doneWithImage=0). Check offline storage / EmptyPageError / logs.`
    );
  }

  console.log(
    `\n✅ Autonomous loop OK — ${doneWithImage}/${imageRows.length} images rendered offline.`
  );
  console.log(`   Book id=${book.id} title="${title}"`);
  console.log(`   Offline files under .offline-storage/ (or OFFLINE_STORAGE_DIR)\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(3);
});
