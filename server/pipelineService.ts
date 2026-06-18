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
import { type ImageGenParams, normalizeImageParams } from "./_core/imageParams";
import { generateScenePrompts, type ScenePrompt } from "./scenePlanner";
import { ENV } from "./_core/env";
import { storagePut } from "./storage";
import {
  createPage,
  updatePage,
  getBookPages,
  createScene,
  updateScene,
  getBookScenes,
  setBookGenerationMode,
  createProcessingJob,
  updateProcessingJob,
  updateBook,
} from "./db";
import { markPageForRetry, markSceneForRetry } from "./retryService";
import type { Page, Scene } from "../drizzle/schema";

export interface PipelineProgress {
  bookId: number;
  totalPages: number;
  processedPages: number;
  currentPage: number;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
}

function extractCharactersFromText(text: string): string[] {
  const characters: string[] = [];
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  const matches = text.match(namePattern) || [];
  const commonWords = new Set(["The","And","But","For","With","From","That","This","Which","When","Where","Why","How"]);
  matches.forEach((match) => { if (!commonWords.has(match) && characters.length < 5) characters.push(match); });
  const uniqueCharacters: string[] = [];
  const seen = new Set<string>();
  for (const char of characters) { if (!seen.has(char)) { uniqueCharacters.push(char); seen.add(char); } }
  return uniqueCharacters;
}

/**
 * Process a single page with context awareness from previous pages.
 * FIX: pushes a PageContext into previousContexts on success so later pages
 * benefit from what was already illustrated.
 */
async function processPagePipelineWithContext(
  bookId: number,
  pageNumber: number,
  pdfBuffer: Buffer,
  ocrText: string,
  previousContexts: PageContext[], // mutated in place on success
  storyContext: StoryContext | null,
  onProgress?: (progress: PipelineProgress) => void
): Promise<Page | null> {
  try {
    console.log(`[Pipeline] Processing page ${pageNumber}: Extracting thumbnail...`);
    const thumbnailBuffer = await generatePageThumbnail(pdfBuffer, pageNumber, 1.0);
    const thumbnailKey = `books/${bookId}/pages/${pageNumber}/thumbnail.png`;
    const { url: thumbnailUrl } = await storagePut(thumbnailKey, thumbnailBuffer, "image/png");

    console.log(`[Pipeline] Processing page ${pageNumber}: Generating prompt...`);
    const promptResult = await generateImagePrompt(
      ocrText, pageNumber,
      previousContexts.length > 0 ? previousContexts : undefined,
      storyContext
    );

    console.log(`[Pipeline] Processing page ${pageNumber}: Generating image...`);
    let generatedImageUrl: string | null = null;
    let generatedImageKey: string | null = null;

    try {
      const imageResult = await generateImage({
        prompt: promptResult.prompt,
        keyPrefix: `books/${bookId}/pages/${pageNumber}/generated`,
      });
      if (imageResult.url) {
        generatedImageUrl = imageResult.url;
        // Record the key the image was ACTUALLY stored under (not a fabricated
        // one) so signed URLs and prefix-based cleanup work.
        generatedImageKey = imageResult.key ?? null;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Pipeline] Failed to generate image for page ${pageNumber}:`, errorMsg);
      const errorPage = await createPage({ bookId, pageNumber, thumbnailFileKey: thumbnailKey, thumbnailUrl, ocrText, generatedPrompt: promptResult.prompt, processingStatus: "error", errorMessage: `Image generation failed: ${errorMsg}` });
      if (errorPage) await markPageForRetry(errorPage.id, bookId, `Image generation failed: ${errorMsg}`, "Image generation error - scheduled for automatic retry");
      throw error;
    }

    console.log(`[Pipeline] Processing page ${pageNumber}: Saving to database...`);
    const page = await createPage({
      bookId, pageNumber, thumbnailFileKey: thumbnailKey, thumbnailUrl, ocrText,
      generatedPrompt: promptResult.prompt,
      generatedImageFileKey: generatedImageKey || undefined,
      generatedImageUrl: generatedImageUrl || undefined,
      processingStatus: "done",
    });

    // FIX: accumulate context so subsequent pages benefit from previous ones
    previousContexts.push({
      pageNumber,
      text: ocrText,
      prompt: promptResult.prompt,
      characters: extractCharactersFromText(ocrText),
      setting: promptResult.mood,
    });

    if (onProgress) onProgress({ bookId, totalPages: 0, processedPages: pageNumber, currentPage: pageNumber, status: "processing" });
    return page;
  } catch (error) {
    console.error(`[Pipeline] Error processing page ${pageNumber}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      const existingPages = await getBookPages(bookId);
      const existing = existingPages.find((p) => p.pageNumber === pageNumber);
      if (existing) { await updatePage(existing.id, { processingStatus: "error", errorMessage }); }
      else { await createPage({ bookId, pageNumber, processingStatus: "error", errorMessage }); }
    } catch (dbErr) { console.error(`[Pipeline] Failed to record error page ${pageNumber}:`, dbErr); }
    throw error;
  }
}

export async function processPagePipeline(
  bookId: number, pageNumber: number, pdfBuffer: Buffer,
  onProgress?: (progress: PipelineProgress) => void
): Promise<Page | null> {
  try {
    const thumbnailBuffer = await generatePageThumbnail(pdfBuffer, pageNumber, 1.0);
    const thumbnailKey = `books/${bookId}/pages/${pageNumber}/thumbnail.png`;
    const { url: thumbnailUrl } = await storagePut(thumbnailKey, thumbnailBuffer, "image/png");
    const ocrResult = await extractTextFromImage(thumbnailBuffer);
    const ocrText = ocrResult.text;
    const promptResult = await generateImagePrompt(ocrText, pageNumber, undefined, undefined);
    let generatedImageUrl: string | null = null;
    let generatedImageKey: string | null = null;
    try {
      const imageResult = await generateImage({ prompt: promptResult.prompt, keyPrefix: `books/${bookId}/pages/${pageNumber}/generated` });
      if (imageResult.url) { generatedImageUrl = imageResult.url; generatedImageKey = imageResult.key ?? null; }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorPage = await createPage({ bookId, pageNumber, thumbnailFileKey: thumbnailKey, thumbnailUrl, ocrText, generatedPrompt: promptResult.prompt, processingStatus: "error", errorMessage: `Image generation failed: ${errorMsg}` });
      if (errorPage) await markPageForRetry(errorPage.id, bookId, `Image generation failed: ${errorMsg}`, "Image generation error - scheduled for automatic retry");
      throw error;
    }
    // Upsert: update the existing record if one exists (e.g. on retry), otherwise insert.
    // This prevents duplicate page rows for the same bookId+pageNumber.
    const allPages = await getBookPages(bookId);
    const existingPage = allPages.find((p) => p.pageNumber === pageNumber);
    let page: Page | null;
    if (existingPage) {
      await updatePage(existingPage.id, {
        thumbnailFileKey: thumbnailKey, thumbnailUrl, ocrText,
        generatedPrompt: promptResult.prompt,
        generatedImageFileKey: generatedImageKey || undefined,
        generatedImageUrl: generatedImageUrl || undefined,
        processingStatus: "done",
        errorMessage: null,
      });
      page = { ...existingPage, thumbnailFileKey: thumbnailKey, thumbnailUrl: thumbnailUrl ?? null, ocrText: ocrText ?? null, generatedPrompt: promptResult.prompt, generatedImageFileKey: generatedImageKey ?? null, generatedImageUrl: generatedImageUrl ?? null, processingStatus: "done", errorMessage: null };
    } else {
      page = await createPage({ bookId, pageNumber, thumbnailFileKey: thumbnailKey, thumbnailUrl, ocrText, generatedPrompt: promptResult.prompt, generatedImageFileKey: generatedImageKey || undefined, generatedImageUrl: generatedImageUrl || undefined, processingStatus: "done" });
    }
    if (onProgress) onProgress({ bookId, totalPages: 0, processedPages: pageNumber, currentPage: pageNumber, status: "processing" });
    return page;
  } catch (error) {
    console.error(`[Pipeline] Error processing page ${pageNumber}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      const existingPages = await getBookPages(bookId);
      const existing = existingPages.find((p) => p.pageNumber === pageNumber);
      if (existing) { await updatePage(existing.id, { processingStatus: "error", errorMessage }); }
      else { await createPage({ bookId, pageNumber, processingStatus: "error", errorMessage }); }
    } catch (dbErr) { console.error(`[Pipeline] Failed to record error page ${pageNumber}:`, dbErr); }
    throw error;
  }
}

/**
 * Process all pages of a PDF book through the pipeline with context awareness.
 *
 * FIX: Skips pages already in "done" state — makes retries safe.
 * FIX: Accumulates PageContext after each success for narrative continuity.
 * FIX: Sets book to "completed" if any pages succeeded; "failed" only if all failed.
 */
const MAX_PAGES = 20;

export async function processBookPipeline(
  bookId: number, pdfBuffer: Buffer,
  onProgress?: (progress: PipelineProgress) => void
): Promise<{ successCount: number; failureCount: number }> {
  // Feature flag: when scene mode is on, plan MULTIPLE distinct scenes per book
  // instead of one image per page. The flag controls behaviour at the single
  // pipeline entry point so callers (upload, retry) need no changes.
  if (ENV.sceneModeEnabled) {
    const { successCount, failureCount } = await processBookPipelineScenes(bookId, pdfBuffer, onProgress);
    return { successCount, failureCount };
  }

  let successCount = 0;
  let failureCount = 0;
  const pageContexts: PageContext[] = [];

  try {
    console.log(`[Pipeline] Starting book ${bookId} processing...`);
    const pdfData = await extractPDFPages(pdfBuffer);
    const totalPages = Math.min(pdfData.totalPages, MAX_PAGES);
    const ocrTexts = pdfData.pages.slice(0, totalPages).map((p) => p.text);
    console.log(`[Pipeline] Processing ${totalPages} pages (capped at MAX_PAGES=${MAX_PAGES})`);

    // FIX: load existing pages once so we can skip already-done ones on retries
    const existingPages = await getBookPages(bookId);
    const donePageNumbers = new Set(existingPages.filter((p) => p.processingStatus === "done").map((p) => p.pageNumber));
    if (donePageNumbers.size > 0) console.log(`[Pipeline] Skipping ${donePageNumbers.size} already-completed page(s)`);

    await updateBook(bookId, { processingStatus: "processing" });

    const storyContext = await buildStoryContext(ocrTexts).catch((err) => {
      console.error("[Pipeline] Story context build failed (continuing without it):", err);
      return null;
    });

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (donePageNumbers.has(pageNum)) {
        console.log(`[Pipeline] Page ${pageNum} already done — skipping`);
        successCount++;
        continue;
      }
      try {
        await processPagePipelineWithContext(bookId, pageNum, pdfBuffer, ocrTexts[pageNum - 1] || "", pageContexts, storyContext, onProgress);
        successCount++;
      } catch (error) {
        console.error(`[Pipeline] Failed to process page ${pageNum}:`, error);
        failureCount++;
      }
      if (onProgress) onProgress({ bookId, totalPages, processedPages: successCount, currentPage: pageNum, status: "processing" });
    }

    // FIX: only mark failed if ALL pages failed; completed if any succeeded
    const finalStatus = successCount > 0 ? "completed" : "failed";
    await updateBook(bookId, { processingStatus: finalStatus });
    if (failureCount > 0 && successCount > 0) console.warn(`[Pipeline] Book ${bookId} completed with ${failureCount} failed page(s). Use retryFailedPages to re-run them.`);
    if (onProgress) onProgress({ bookId, totalPages, processedPages: successCount, currentPage: totalPages, status: "completed" });

    return { successCount, failureCount };
  } catch (error) {
    console.error(`[Pipeline] Fatal error processing book ${bookId}:`, error);
    await updateBook(bookId, { processingStatus: "failed" });
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (onProgress) onProgress({ bookId, totalPages: 0, processedPages: 0, currentPage: 0, status: "failed", error: errorMessage });
    throw error;
  }
}

/* ===========================================================================
 * Scene-based pipeline (multiple distinct images per book)
 * ===========================================================================
 *
 * Decoupling invariant -- UPHELD: OCR transcription stays decoupled from image
 * generation. Flow here is OCR text -> story bible (StoryContext) -> scene plan
 * -> prompts -> image generation. scenePlanner never touches OCR and never calls
 * the image generator; THIS pipeline is the only caller of generateImage. The
 * story bible remains the sole mediator between transcription and rendering.
 *
 * PERSISTENCE: scene-mode books write EXCLUSIVELY to the dedicated `scenes`
 * table -- never to `pages`. No synthetic page rows. The book is flipped to
 * generationMode = "scene" so the read path knows which table to query. Each
 * scene captures its real title, source page, rationale, prompt and image at
 * generation time (structured + lossless), keyed by 0-based sceneIndex.
 */

/** Persist a single planned scene to the scenes table: thumbnail + image + row. */
async function processScene(
  bookId: number,
  sceneIndex: number,
  pdfBuffer: Buffer,
  scenePrompt: ScenePrompt,
  imageParams: ImageGenParams,
  existing?: Scene
): Promise<Scene | null> {
  const { scene } = scenePrompt;
  console.log(`[Pipeline:Scenes] Scene #${sceneIndex} ("${scene.title}", source p.${scene.sourcePage}): thumbnail...`);
  const thumbnailBuffer = await generatePageThumbnail(pdfBuffer, scene.sourcePage, 1.0);
  const thumbnailKey = `books/${bookId}/scenes/${sceneIndex}/thumbnail.png`;
  const { url: thumbnailUrl } = await storagePut(thumbnailKey, thumbnailBuffer, "image/png");

  // Structured, lossless capture of the generation context (Jerome's caveat):
  // title, rationale, source page, prompt, art-direction tags AND the resolved
  // render params (aspect/quality/style) recorded now, while still in hand --
  // not reconstructed from strings later. Render params are kept distinct from
  // the art-direction style/mood so the exact size/quality used is auditable.
  const baseFields = {
    bookId,
    sceneIndex,
    title: scene.title,
    rationale: scene.rationale,
    sourcePage: scene.sourcePage,
    importance: scene.importance,
    description: scene.description,
    prompt: scenePrompt.prompt,
    generationParams: JSON.stringify({
      style: scenePrompt.style,
      mood: scenePrompt.mood,
      render: imageParams,
    }),
    thumbnailFileKey: thumbnailKey,
    thumbnailUrl,
  };

  let generatedImageUrl: string | null = null;
  let generatedImageKey: string | null = null;
  try {
    console.log(`[Pipeline:Scenes] Scene #${sceneIndex}: generating image...`);
    const imageResult = await generateImage({
      prompt: scenePrompt.prompt,
      keyPrefix: `books/${bookId}/scenes/${sceneIndex}/generated`,
      params: imageParams,
    });
    if (imageResult.url) {
      generatedImageUrl = imageResult.url;
      // Record the key the image was ACTUALLY stored under (not a fabricated one).
      generatedImageKey = imageResult.key ?? null;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Pipeline:Scenes] Image generation failed for scene #${sceneIndex} ("${scene.title}"):`, errorMsg);
    // Upsert the scene row in error state, then schedule automatic retry.
    let sceneId = existing?.id;
    if (existing) {
      await updateScene(existing.id, { ...baseFields, processingStatus: "error", errorMessage: `Image generation failed: ${errorMsg}` });
    } else {
      const created = await createScene({ ...baseFields, processingStatus: "error", errorMessage: `Image generation failed: ${errorMsg}` });
      sceneId = created?.id;
    }
    if (sceneId) await markSceneForRetry(sceneId, bookId, `Image generation failed: ${errorMsg}`, "Scene image generation error - scheduled for automatic retry");
    throw error;
  }

  const doneFields = {
    ...baseFields,
    generatedImageFileKey: generatedImageKey ?? undefined,
    generatedImageUrl: generatedImageUrl ?? undefined,
    processingStatus: "done" as const,
    errorMessage: null,
  };

  if (existing) {
    await updateScene(existing.id, doneFields);
    return { ...existing, ...doneFields, generatedImageFileKey: generatedImageKey ?? null, generatedImageUrl: generatedImageUrl ?? null, errorMessage: null };
  }
  return createScene(doneFields);
}

/**
 * Scene-based book processing: extract text, build the story bible, plan a set
 * of distinct scenes, then render one image per scene into the scenes table.
 * Returns scene counts. Writes ONLY to `scenes` -- never to `pages`.
 */
export async function processBookPipelineScenes(
  bookId: number, pdfBuffer: Buffer,
  onProgress?: (progress: PipelineProgress) => void,
  imageParams?: Partial<ImageGenParams>
): Promise<{ successCount: number; failureCount: number; sceneCount: number }> {
  let successCount = 0;
  let failureCount = 0;

  // Resolve render params ONCE so every scene in a book shares one shape/quality
  // and the recorded params are consistent. Defaults preserve legacy behaviour.
  const resolvedImageParams = normalizeImageParams(imageParams);

  try {
    console.log(`[Pipeline:Scenes] Starting book ${bookId} scene-based processing...`);
    const pdfData = await extractPDFPages(pdfBuffer);
    const totalPages = Math.min(pdfData.totalPages, MAX_PAGES);
    const ocrTexts = pdfData.pages.slice(0, totalPages).map((p) => p.text);

    // Flip the book onto the scene write-path so the read path queries scenes.
    await setBookGenerationMode(bookId, "scene");
    await updateBook(bookId, { processingStatus: "processing" });

    // Story bible mediates between transcription and rendering.
    const storyContext = await buildStoryContext(ocrTexts).catch((err) => {
      console.error("[Pipeline:Scenes] Story context build failed (continuing without it):", err);
      return null;
    });

    // Decoupled: planner consumes OCR text + bible and returns PROMPTS only.
    const scenePrompts = await generateScenePrompts(ocrTexts, storyContext);
    const sceneCount = scenePrompts.length;
    console.log(`[Pipeline:Scenes] Planned ${sceneCount} distinct scene(s) for book ${bookId}.`);

    if (sceneCount === 0) {
      await updateBook(bookId, { processingStatus: "failed" });
      if (onProgress) onProgress({ bookId, totalPages: 0, processedPages: 0, currentPage: 0, status: "failed", error: "No illustratable scenes found" });
      return { successCount: 0, failureCount: 0, sceneCount: 0 };
    }

    // Existing scenes (safe re-runs), keyed by 0-based sceneIndex.
    const existingScenes = await getBookScenes(bookId);
    const byIndex = new Map(existingScenes.map((sc) => [sc.sceneIndex, sc]));
    const doneCount = existingScenes.filter((sc) => sc.processingStatus === "done").length;
    if (doneCount > 0) console.log(`[Pipeline:Scenes] ${doneCount} scene(s) already rendered; will skip those`);

    for (let i = 0; i < sceneCount; i++) {
      const existing = byIndex.get(i);
      if (existing && existing.processingStatus === "done") {
        console.log(`[Pipeline:Scenes] Scene #${i} already done -- skipping`);
        successCount++;
        continue;
      }
      try {
        await processScene(bookId, i, pdfBuffer, scenePrompts[i], resolvedImageParams, existing);
        successCount++;
      } catch (error) {
        console.error(`[Pipeline:Scenes] Failed to process scene #${i}:`, error);
        failureCount++;
      }
      if (onProgress) onProgress({ bookId, totalPages: sceneCount, processedPages: successCount, currentPage: i + 1, status: "processing" });
    }

    const finalStatus = successCount > 0 ? "completed" : "failed";
    await updateBook(bookId, { processingStatus: finalStatus });
    if (failureCount > 0 && successCount > 0) console.warn(`[Pipeline:Scenes] Book ${bookId} completed with ${failureCount} failed scene(s).`);
    if (onProgress) onProgress({ bookId, totalPages: sceneCount, processedPages: successCount, currentPage: sceneCount, status: "completed" });

    return { successCount, failureCount, sceneCount };
  } catch (error) {
    console.error(`[Pipeline:Scenes] Fatal error processing book ${bookId}:`, error);
    await updateBook(bookId, { processingStatus: "failed" });
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (onProgress) onProgress({ bookId, totalPages: 0, processedPages: 0, currentPage: 0, status: "failed", error: errorMessage });
    throw error;
  }
}
