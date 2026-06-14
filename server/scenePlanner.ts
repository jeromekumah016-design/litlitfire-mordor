import { invokeLLM } from "./_core/llm";
import {
  generateImagePrompt,
  type GeneratedPrompt,
  type StoryContext,
} from "./promptService";

/**
 * Scene Planner
 * =============
 *
 * Problem this solves
 * -------------------
 * The original pipeline illustrated books one-image-per-page. That is rigid:
 *  - A dense page may contain two or three distinct illustration-worthy moments.
 *  - A sparse page (dialogue, a transition) may deserve no illustration at all.
 *  - Two adjacent pages can describe the same single scene → duplicate images.
 *
 * The scene planner reads the whole book (via the OCR text) together with the
 * locked visual bible (StoryContext) and selects the MOST illustration-worthy,
 * visually DISTINCT scenes across the entire book. The result is multiple
 * distinct, relevant images per book — not a mechanical 1:1 page mapping.
 *
 * Decoupling invariant
 * --------------------
 * OCR transcription stays decoupled from image generation. This module never
 * touches OCR and never calls the image generator. It consumes already-extracted
 * text plus the story-bible (StoryContext) and emits a plan + prompts. The
 * story-bible remains the mediator between transcription and rendering.
 */

export interface Scene {
  /** 1-based page the scene is primarily drawn from (for ordering & display). */
  sourcePage: number;
  /** Short human-readable label, e.g. "The parting of the sea". */
  title: string;
  /** What the illustration should depict — fed to the prompt generator as the scene text. */
  description: string;
  /** Why this moment was chosen (debugging / dev-mode transparency). */
  rationale: string;
  /** 1 (minor) … 5 (pivotal). Used to rank and cap the plan. */
  importance: number;
}

export interface ScenePrompt extends GeneratedPrompt {
  scene: Scene;
}

export interface ScenePlanOptions {
  /** Hard ceiling on the number of scenes/images produced for the book. */
  maxScenes?: number;
  /** Floor — try to produce at least this many when there is enough material. */
  minScenes?: number;
}

export const DEFAULT_MAX_SCENES = 12;
export const DEFAULT_MIN_SCENES = 1;

/** A page must have at least this many non-whitespace chars to be illustratable. */
const MIN_MEANINGFUL_CHARS = 20;

/**
 * Clamp a requested scene count into a sane, non-negative range.
 * Exported for direct unit testing.
 */
export function clampSceneCount(
  requested: number,
  available: number,
  opts?: ScenePlanOptions
): number {
  const max = Math.max(1, opts?.maxScenes ?? DEFAULT_MAX_SCENES);
  const min = Math.max(0, opts?.minScenes ?? DEFAULT_MIN_SCENES);
  // Never plan more scenes than we could meaningfully draw from.
  const ceiling = Math.min(max, Math.max(0, available));
  const floor = Math.min(min, ceiling);
  if (requested < floor) return floor;
  if (requested > ceiling) return ceiling;
  return requested;
}

/** Normalise a string for similarity comparison. */
function normaliseForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove near-duplicate scenes so the book never gets two images of the same
 * moment. Duplicates are detected by (sourcePage + normalised title) and by
 * identical normalised descriptions. Order is preserved; the first occurrence
 * wins. Exported for direct unit testing.
 */
export function dedupeScenes(scenes: Scene[]): Scene[] {
  const seenKeys = new Set<string>();
  const seenDescriptions = new Set<string>();
  const out: Scene[] = [];

  for (const scene of scenes) {
    const titleKey = `${scene.sourcePage}:${normaliseForCompare(scene.title)}`;
    const descKey = normaliseForCompare(scene.description);

    if (seenKeys.has(titleKey)) continue;
    if (descKey.length > 0 && seenDescriptions.has(descKey)) continue;

    seenKeys.add(titleKey);
    if (descKey.length > 0) seenDescriptions.add(descKey);
    out.push(scene);
  }

  return out;
}

/**
 * Rank scenes by importance (desc), tie-broken by source page (asc), then cap
 * to `limit`. The capped result is returned in reading order (page asc) so the
 * illustrations still flow with the narrative. Exported for unit testing.
 */
export function rankAndCapScenes(scenes: Scene[], limit: number): Scene[] {
  if (limit <= 0) return [];
  const ranked = [...scenes].sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance;
    return a.sourcePage - b.sourcePage;
  });
  const kept = ranked.slice(0, limit);
  return kept.sort((a, b) => a.sourcePage - b.sourcePage);
}

/**
 * Deterministic fallback used when the LLM is unavailable or returns nothing.
 * Picks one scene per meaningful page (capped). No network, fully testable.
 * Exported for unit testing.
 */
export function buildFallbackScenes(
  ocrTexts: string[],
  opts?: ScenePlanOptions
): Scene[] {
  const candidates: Scene[] = [];
  ocrTexts.forEach((text, i) => {
    const trimmed = (text ?? "").trim();
    if (trimmed.length < MIN_MEANINGFUL_CHARS) return;
    candidates.push({
      sourcePage: i + 1,
      title: `Page ${i + 1}`,
      description: trimmed.substring(0, 500),
      rationale: "Fallback: one scene per page (LLM scene planning unavailable).",
      importance: 3,
    });
  });

  const limit = clampSceneCount(candidates.length, candidates.length, opts);
  return candidates.slice(0, limit);
}

/** Coerce arbitrary LLM output into a clean, validated Scene[]. */
function sanitiseLLMScenes(raw: unknown, pageCount: number): Scene[] {
  if (!Array.isArray(raw)) return [];
  const out: Scene[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const description = typeof r.description === "string" ? r.description.trim() : "";
    if (description.length === 0) continue;

    let sourcePage = Number.isFinite(r.sourcePage) ? Math.floor(Number(r.sourcePage)) : 1;
    if (sourcePage < 1) sourcePage = 1;
    if (pageCount > 0 && sourcePage > pageCount) sourcePage = pageCount;

    let importance = Number.isFinite(r.importance) ? Math.floor(Number(r.importance)) : 3;
    if (importance < 1) importance = 1;
    if (importance > 5) importance = 5;

    out.push({
      sourcePage,
      title: typeof r.title === "string" && r.title.trim().length > 0 ? r.title.trim() : `Page ${sourcePage}`,
      description,
      rationale: typeof r.rationale === "string" ? r.rationale.trim() : "",
      importance,
    });
  }
  return out;
}

/**
 * Select the most illustration-worthy, visually distinct scenes across a book.
 *
 * Reads every page (truncated for token economy) plus the visual bible, asks the
 * LLM to choose distinct illustration beats, then dedupes, ranks and caps them.
 * Falls back to a deterministic one-scene-per-page plan if the LLM fails.
 */
export async function selectScenes(
  ocrTexts: string[],
  storyContext?: StoryContext | null,
  opts?: ScenePlanOptions
): Promise<Scene[]> {
  const meaningfulCount = ocrTexts.filter(
    (t) => (t ?? "").trim().length >= MIN_MEANINGFUL_CHARS
  ).length;
  if (meaningfulCount === 0) return [];

  const targetCount = clampSceneCount(
    opts?.maxScenes ?? DEFAULT_MAX_SCENES,
    meaningfulCount,
    opts
  );

  try {
    const fullScan = ocrTexts
      .map((t, i) => `--- Page ${i + 1} ---\n${(t ?? "").substring(0, 350)}`)
      .join("\n\n");

    const bibleNote = storyContext
      ? `\n\nVisual bible already established:\nTONE: ${storyContext.tone}\nART STYLE: ${storyContext.artStyle}\nARC: ${storyContext.narrativeSummary}`
      : "";

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are the art director planning which moments of a book get illustrated.
You do NOT illustrate every page. You choose the most visually compelling, narratively important,
and DISTINCT scenes across the whole book. Rules:
• Never select two scenes that depict the same moment — each illustration must be visually distinct.
• A single dense page may yield more than one scene; a sparse page may yield none.
• Prefer scenes with concrete, drawable action, setting, or character moments over abstract passages.
• Spread selections across the book so the illustrations track the narrative arc.
• Choose at most ${targetCount} scenes.`,
        },
        {
          role: "user",
          content: `Here is the full text of the book, page by page. Select up to ${targetCount} distinct illustration-worthy scenes.${bibleNote}

${fullScan}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "scene_plan",
          strict: true,
          schema: {
            type: "object",
            properties: {
              scenes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sourcePage: {
                      type: "integer",
                      description: "1-based page the scene is primarily drawn from",
                    },
                    title: { type: "string", description: "Short label for the scene" },
                    description: {
                      type: "string",
                      description: "What the illustration should depict — concrete, drawable",
                    },
                    rationale: {
                      type: "string",
                      description: "Why this moment was chosen for illustration",
                    },
                    importance: {
                      type: "integer",
                      description: "1 (minor) to 5 (pivotal)",
                    },
                  },
                  required: ["sourcePage", "title", "description", "rationale", "importance"],
                  additionalProperties: false,
                },
              },
            },
            required: ["scenes"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message.content;
    if (!content) return buildFallbackScenes(ocrTexts, opts);

    const contentStr = typeof content === "string" ? content : JSON.stringify(content);
    const parsed = JSON.parse(contentStr) as { scenes?: unknown };
    const sanitised = sanitiseLLMScenes(parsed.scenes, ocrTexts.length);

    if (sanitised.length === 0) return buildFallbackScenes(ocrTexts, opts);

    const deduped = dedupeScenes(sanitised);
    const finalCount = clampSceneCount(targetCount, deduped.length, opts);
    const plan = rankAndCapScenes(deduped, finalCount);

    console.log(
      `[ScenePlanner] Selected ${plan.length} distinct scene(s) from ${ocrTexts.length} page(s) ` +
      `(${meaningfulCount} meaningful, target ${targetCount}).`
    );
    return plan.length > 0 ? plan : buildFallbackScenes(ocrTexts, opts);
  } catch (error) {
    console.error("[ScenePlanner] Scene selection failed, using fallback:", error);
    return buildFallbackScenes(ocrTexts, opts);
  }
}

/**
 * End-to-end planning: select distinct scenes, then generate one image prompt
 * per scene using the locked visual bible. Returns prompts paired with their
 * scenes, in reading order. This is what the pipeline can call to produce
 * multiple distinct, relevant images per book.
 *
 * Still decoupled: this returns PROMPTS only. The caller (pipeline) is the one
 * that invokes the image generator. OCR is never touched here.
 */
export async function generateScenePrompts(
  ocrTexts: string[],
  storyContext?: StoryContext | null,
  opts?: ScenePlanOptions
): Promise<ScenePrompt[]> {
  const scenes = await selectScenes(ocrTexts, storyContext, opts);
  const out: ScenePrompt[] = [];

  for (const scene of scenes) {
    try {
      const prompt = await generateImagePrompt(
        scene.description,
        scene.sourcePage,
        undefined,
        storyContext ?? undefined
      );
      out.push({ ...prompt, scene });
    } catch (error) {
      console.error(
        `[ScenePlanner] Prompt generation failed for scene "${scene.title}" (page ${scene.sourcePage}):`,
        error
      );
      out.push({
        prompt: scene.description.substring(0, 200),
        style: storyContext?.artStyle ?? "illustration",
        mood: "neutral",
        scene,
      });
    }
  }

  return out;
}
