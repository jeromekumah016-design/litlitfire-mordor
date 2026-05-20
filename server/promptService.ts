import { invokeLLM } from "./_core/llm";

export interface GeneratedPrompt {
  prompt: string;
  style?: string;
  mood?: string;
}

export interface PageContext {
  pageNumber: number;
  text: string;
  prompt: string;
  characters?: string[];
  setting?: string;
}

/**
 * Global narrative context extracted once from the opening pages of a book.
 * Every page's prompt is generated using this so the art style, characters,
 * and setting stay consistent from page 1 to the last page.
 */
export interface StoryContext {
  /** All named characters with enough visual detail to paint them consistently */
  characters: Array<{ name: string; description: string }>;
  /** World / location / environment (e.g. "Ancient Egypt, sandstone temples, the Nile") */
  setting: string;
  /** Historical or fictional time period (e.g. "1300 BCE", "Middle Earth") */
  timePeriod: string;
  /**
   * Consistent art style locked in for every page
   * (e.g. "classical oil painting, warm earth tones, dramatic chiaroscuro lighting")
   */
  artStyle: string;
  /** 2-3 sentence plain-English summary of the story */
  narrativeSummary: string;
}

/**
 * Make one LLM call to read the opening pages of a book and establish the
 * visual language (art style, characters, setting) that all page illustrations
 * must follow. Returns null on failure — the pipeline continues without it.
 */
export async function buildStoryContext(
  pageTexts: string[]
): Promise<StoryContext | null> {
  try {
    const meaningful = pageTexts.filter((t) => t.trim().length > 20);
    if (meaningful.length === 0) return null;

    // Sample the first 5 non-empty pages — enough to understand the story without
    // burning tokens on the full book
    const sample = meaningful
      .slice(0, 5)
      .map((t, i) => `--- Page ${i + 1} ---\n${t.substring(0, 600)}`)
      .join("\n\n");

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an art director for an illustrated book.
Your job is to read the opening pages of a book and establish a single, locked-in visual style
that every page illustration must follow so the book looks like one cohesive artwork.
Focus on: consistent character appearances, a unified art style, and accurate time period.`,
        },
        {
          role: "user",
          content: `Read these opening pages and define the visual language for illustrating the entire book:

${sample}

Return the visual context as JSON.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "story_context",
          strict: true,
          schema: {
            type: "object",
            properties: {
              characters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: {
                      type: "string",
                      description:
                        "Physical appearance, clothing, hair, notable features — enough for an artist to paint this character the same way every time",
                    },
                  },
                  required: ["name", "description"],
                  additionalProperties: false,
                },
              },
              setting: {
                type: "string",
                description:
                  "Primary world/location (e.g. 'Ancient Egypt: desert dunes, the Nile River, sandstone temples with hieroglyphics')",
              },
              timePeriod: {
                type: "string",
                description: "Historical or fictional era (e.g. '1300 BCE Egypt', 'Victorian London')",
              },
              artStyle: {
                type: "string",
                description:
                  "Exact art style to use for EVERY illustration (e.g. 'classical oil painting in the style of Rembrandt, warm ochre and gold tones, dramatic lighting from above')",
              },
              narrativeSummary: {
                type: "string",
                description: "2-3 sentence plain-English summary of what happens in these pages",
              },
            },
            required: ["characters", "setting", "timePeriod", "artStyle", "narrativeSummary"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message.content;
    if (!content) return null;

    const contentStr = typeof content === "string" ? content : JSON.stringify(content);
    const parsed = JSON.parse(contentStr) as StoryContext;
    console.log(
      `[PromptService] Story context: ${parsed.characters.length} characters, style: "${parsed.artStyle.substring(0, 60)}..."`
    );
    return parsed;
  } catch (error) {
    console.error("[PromptService] Failed to build story context:", error);
    return null;
  }
}

/**
 * Generate an image generation prompt for a single page.
 *
 * @param ocrText      Extracted text from this page
 * @param pageNumber   1-indexed page number (used for context messages)
 * @param previousContext  Prompts/text from recent preceding pages
 * @param storyContext Global narrative context (characters, style, setting)
 *                     built once for the whole book
 */
export async function generateImagePrompt(
  ocrText: string,
  pageNumber?: number,
  previousContext?: PageContext[],
  storyContext?: StoryContext | null
): Promise<GeneratedPrompt> {
  try {
    if (!ocrText || ocrText.trim().length === 0) {
      const style = storyContext?.artStyle ?? "minimalist illustration";
      return {
        prompt: `An empty page, ${style}`,
        style,
        mood: "calm",
      };
    }

    const truncatedText = ocrText.substring(0, 500);

    // ── System prompt: lock in story-wide visual style ──────────────────────
    let systemPrompt = `You are a creative prompt engineer for book illustration.
Given text from a single book page, write a vivid 1-2 sentence image-generation prompt
that captures the scene described on that page.`;

    if (storyContext) {
      const characterList =
        storyContext.characters.length > 0
          ? storyContext.characters
              .map((c) => `  • ${c.name}: ${c.description}`)
              .join("\n")
          : "  (no named characters identified)";

      systemPrompt += `

══ LOCKED VISUAL STYLE — apply to every single page ══
Setting:     ${storyContext.setting}
Time period: ${storyContext.timePeriod}
Art style:   ${storyContext.artStyle}
Story:       ${storyContext.narrativeSummary}

Named characters — use these EXACT descriptions whenever a character appears:
${characterList}

Rules:
1. ALWAYS use the art style above. Never deviate from it.
2. If a named character appears, describe them using ONLY the description above.
3. Keep the setting consistent with the world defined above.
4. Maintain the chronological order of events — do not skip ahead or go back.`;
    } else {
      systemPrompt += `

Maintain visual and thematic consistency with previous pages.
Preserve character appearances and settings across pages.`;
    }

    // ── User message: recent page context + this page's text ────────────────
    let recentContextBlock = "";
    if (previousContext && previousContext.length > 0) {
      const recent = previousContext.slice(-3);
      recentContextBlock = `\n\nRecent pages for narrative continuity:\n${recent
        .map(
          (ctx) =>
            `Page ${ctx.pageNumber}: "${ctx.text.substring(0, 120)}..."\nPrompt used: ${ctx.prompt.substring(0, 80)}...`
        )
        .join("\n\n")}`;
    }

    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Generate an image prompt for this book page:

${pageNumber ? `Page ${pageNumber}\n` : ""}Text: "${truncatedText}"${recentContextBlock}

Return JSON with:
- prompt: the image generation prompt (1-2 sentences, include art style and any characters/setting)
- style: art style used
- mood: emotional mood of the scene`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "image_prompt",
          strict: true,
          schema: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              style: { type: "string" },
              mood: { type: "string" },
            },
            required: ["prompt", "style", "mood"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("No response from LLM");

    const contentStr = typeof content === "string" ? content : JSON.stringify(content);
    const parsed = JSON.parse(contentStr);
    return {
      prompt: parsed.prompt,
      style: parsed.style,
      mood: parsed.mood,
    };
  } catch (error) {
    console.error("Error generating image prompt:", error);
    throw new Error(
      `Prompt generation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate prompts for multiple pages with full context awareness.
 * Builds a story context first, then generates each prompt in order.
 */
export async function generateImagePromptsWithContext(
  ocrTexts: string[]
): Promise<GeneratedPrompt[]> {
  const storyContext = await buildStoryContext(ocrTexts);
  const prompts: GeneratedPrompt[] = [];
  const pageContexts: PageContext[] = [];

  for (let i = 0; i < ocrTexts.length; i++) {
    try {
      const pageNumber = i + 1;
      const prompt = await generateImagePrompt(
        ocrTexts[i],
        pageNumber,
        pageContexts.length > 0 ? pageContexts : undefined,
        storyContext
      );
      prompts.push(prompt);

      pageContexts.push({
        pageNumber,
        text: ocrTexts[i],
        prompt: prompt.prompt,
        characters: extractCharacters(ocrTexts[i]),
        setting: prompt.mood,
      });

      if (i < ocrTexts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Error generating prompt for page ${i + 1}:`, error);
      prompts.push({
        prompt: "A page from a book",
        style: "illustration",
        mood: "neutral",
      });
    }
  }

  return prompts;
}

/** @deprecated Use generateImagePromptsWithContext */
export async function generateImagePrompts(ocrTexts: string[]): Promise<GeneratedPrompt[]> {
  return generateImagePromptsWithContext(ocrTexts);
}

function extractCharacters(text: string): string[] {
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  const commonWords = new Set([
    "The", "And", "But", "For", "With", "From", "That", "This",
    "Which", "When", "Where", "Why", "How",
  ]);
  const seen = new Set<string>();
  const characters: string[] = [];
  for (const match of text.match(namePattern) ?? []) {
    if (!commonWords.has(match) && !seen.has(match) && characters.length < 5) {
      characters.push(match);
      seen.add(match);
    }
  }
  return characters;
}
