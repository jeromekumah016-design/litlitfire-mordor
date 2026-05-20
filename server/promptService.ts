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
 * Full narrative map built once from ALL pages before any image is generated.
 *
 * Every field here is something that causes visual confusion or inconsistency
 * if the illustrator doesn't know about it from the start:
 *
 * - characters   → who they are and what they look like (Moses ≠ Aaron ≠ Pharaoh)
 * - factions     → groups that appear as crowds (Israelites vs. Egyptians)
 * - locations    → named places the story moves through (Egypt → Sinai → Canaan)
 * - keyObjects   → artifacts with specific appearances (the Ark, the tablets, a ring)
 * - chronology   → the ordered event list so page 3 can't show what page 10 reveals
 * - relationships→ who is connected to whom (prevents mix-ups like Moses/Aaron/Pharaoh)
 * - visualMotifs → recurring symbols that should look the same every time (burning bush, cross)
 * - tone         → overall emotional register kept consistent (epic, intimate, dark)
 * - artStyle     → locked painting/illustration style used on every single page
 * - setting      → world-level environment description
 * - timePeriod   → era so anachronisms are impossible
 * - narrativeSummary → plain-English story arc for the LLM to reason about
 */
export interface StoryContext {
  characters: Array<{
    name: string;
    /** Full visual description: age, hair, skin, clothing, build, distinguishing features */
    visualDescription: string;
    /** Their role in the story: protagonist/antagonist/mentor/etc. */
    role: string;
    /** e.g. ["brother of Aaron", "son of Amram", "leader of the Israelites"] */
    relationships: string[];
  }>;
  factions: Array<{
    name: string;
    /** Visual markers: how to tell this group apart in a crowd — clothing, colors, symbols */
    visualMarkers: string;
    alignment: "protagonist" | "antagonist" | "neutral";
  }>;
  locations: Array<{
    name: string;
    /** What it looks like — architecture, landscape, light quality, color palette */
    visualDescription: string;
  }>;
  keyObjects: Array<{
    name: string;
    /** Exact visual description so the object looks the same every time it appears */
    visualDescription: string;
    /** Why it matters — helps the LLM know when to include it */
    significance: string;
  }>;
  /**
   * Ordered list of key events across ALL pages being processed.
   * Written as "Page N: <event>" so the LLM knows what has already happened
   * vs. what is yet to come when it generates each page's prompt.
   */
  chronology: string[];
  /**
   * Recurring visual symbols or motifs that must look identical every time
   * they appear (e.g. "burning bush: a desert shrub engulfed in golden flame
   * that does not burn the leaves").
   */
  visualMotifs: Array<{ name: string; description: string }>;
  /**
   * Important relationships that could cause confusion if ignored
   * (e.g. "Moses and Aaron are brothers", "Judas is one of the 12 disciples").
   */
  relationships: string[];
  /** Overall emotional register of the story — kept consistent across all pages */
  tone: string;
  /** World/environment — the canvas the entire story is painted on */
  setting: string;
  /** Historical or fictional era — prevents anachronisms */
  timePeriod: string;
  /**
   * The ONE art style used for every single page.
   * Must be specific enough that every illustration looks like it came from
   * the same artist (e.g. "classical oil painting, Rembrandt lighting,
   * warm ochre and umber palette, dramatic chiaroscuro").
   */
  artStyle: string;
  /** 2–4 sentence summary of the full narrative arc being illustrated */
  narrativeSummary: string;
}

/**
 * Build the full narrative map from ALL pages that will be illustrated.
 *
 * Reads every page (truncated to 350 chars each so token cost stays low),
 * sends them to the LLM in one call, and returns a StoryContext that the
 * pipeline injects into every subsequent prompt — ensuring visual and
 * narrative consistency from page 1 to the last.
 *
 * Returns null if the call fails; the pipeline continues with degraded quality.
 */
export async function buildStoryContext(
  pageTexts: string[]
): Promise<StoryContext | null> {
  try {
    const meaningful = pageTexts.filter((t) => t.trim().length > 20);
    if (meaningful.length === 0) return null;

    // Include ALL pages (truncated) so we know every character/location/event
    // that will be illustrated — not just the ones in the first few pages.
    const fullScan = meaningful
      .map((t, i) => `--- Page ${i + 1} ---\n${t.substring(0, 350)}`)
      .join("\n\n");

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are the lead art director for an illustrated edition of a book.
Before a single illustration is drawn, you read the ENTIRE text that will be illustrated
and produce a comprehensive visual bible — a locked-in reference that every artist must follow.

Your visual bible must capture every element that could cause confusion or inconsistency
if not established upfront:
• Characters who appear more than once must look identical each time
• Groups/factions must be visually distinguishable from each other
• Named locations must have a consistent visual description
• Important objects must look the same every time they appear
• The chronological order of events must be respected — an artist drawing page 5
  must not accidentally depict something that only happens on page 15
• Relationships (family, allegiance, opposition) must be noted so characters
  are never placed in the wrong social context
• The art style must be specific enough that every illustration looks like it came
  from the same hand`,
        },
        {
          role: "user",
          content: `Read all the following pages — this is the complete text that will be illustrated.
Produce the full visual bible as JSON.

${fullScan}`,
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
                    visualDescription: {
                      type: "string",
                      description:
                        "Age, hair color/style, skin tone, build, clothing, any distinctive physical features — detailed enough for an artist to paint this character identically on every page they appear",
                    },
                    role: {
                      type: "string",
                      description: "Their narrative role: protagonist / antagonist / mentor / sidekick / etc.",
                    },
                    relationships: {
                      type: "array",
                      items: { type: "string" },
                      description: "Relationships to other characters (e.g. 'brother of Aaron', 'disciple of Jesus')",
                    },
                  },
                  required: ["name", "visualDescription", "role", "relationships"],
                  additionalProperties: false,
                },
              },
              factions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    visualMarkers: {
                      type: "string",
                      description:
                        "How to tell this group apart in a crowd: clothing colors, symbols, uniforms, cultural markers",
                    },
                    alignment: {
                      type: "string",
                      enum: ["protagonist", "antagonist", "neutral"],
                    },
                  },
                  required: ["name", "visualMarkers", "alignment"],
                  additionalProperties: false,
                },
              },
              locations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    visualDescription: {
                      type: "string",
                      description:
                        "Architecture, landscape, lighting, dominant colors — what this place looks like",
                    },
                  },
                  required: ["name", "visualDescription"],
                  additionalProperties: false,
                },
              },
              keyObjects: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    visualDescription: {
                      type: "string",
                      description: "Exact appearance: shape, material, color, size",
                    },
                    significance: { type: "string" },
                  },
                  required: ["name", "visualDescription", "significance"],
                  additionalProperties: false,
                },
              },
              chronology: {
                type: "array",
                items: { type: "string" },
                description:
                  "Ordered list of key story events, written as 'Page N: <what happens>' so illustrations can respect narrative order",
              },
              visualMotifs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: {
                      type: "string",
                      description: "Exact visual description so this symbol looks identical every time it appears",
                    },
                  },
                  required: ["name", "description"],
                  additionalProperties: false,
                },
              },
              relationships: {
                type: "array",
                items: { type: "string" },
                description:
                  "Key relationships that must not be confused: family ties, allegiances, oppositions",
              },
              tone: {
                type: "string",
                description:
                  "Overall emotional register of the story (e.g. 'epic and reverent', 'dark and gritty', 'whimsical and lighthearted')",
              },
              setting: {
                type: "string",
                description:
                  "World-level environment — the canvas the story is painted on (e.g. 'Ancient Egypt: sand dunes, the Nile River, sandstone temples with hieroglyphics and torchlight')",
              },
              timePeriod: {
                type: "string",
                description: "Era — prevents anachronisms (e.g. '1300 BCE', 'Victorian London 1880s', 'A galaxy far, far away')",
              },
              artStyle: {
                type: "string",
                description:
                  "The single art style used for every illustration — must be specific enough that all pages look like one artist made them (e.g. 'classical oil painting in the style of Gustave Doré, dramatic chiaroscuro lighting, warm sepia and gold tones, highly detailed linework')",
              },
              narrativeSummary: {
                type: "string",
                description: "2–4 sentence plain-English arc of everything that happens in the pages being illustrated",
              },
            },
            required: [
              "characters",
              "factions",
              "locations",
              "keyObjects",
              "chronology",
              "visualMotifs",
              "relationships",
              "tone",
              "setting",
              "timePeriod",
              "artStyle",
              "narrativeSummary",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message.content;
    if (!content) return null;

    const contentStr = typeof content === "string" ? content : JSON.stringify(content);
    const ctx = JSON.parse(contentStr) as StoryContext;

    console.log(
      `[PromptService] Visual bible built: ${ctx.characters.length} characters, ` +
      `${ctx.factions.length} factions, ${ctx.locations.length} locations, ` +
      `${ctx.keyObjects.length} objects, ${ctx.chronology.length} events`
    );
    return ctx;
  } catch (error) {
    console.error("[PromptService] Failed to build story context:", error);
    return null;
  }
}

/**
 * Generate an image generation prompt for a single page.
 *
 * Uses the full StoryContext (visual bible) so every element — characters,
 * factions, locations, objects, motifs — is rendered consistently and in
 * the correct narrative order.
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
      return { prompt: `An empty page, ${style}`, style, mood: "calm" };
    }

    const truncatedText = ocrText.substring(0, 500);

    // ── Build system prompt from the visual bible ──────────────────────────
    let systemPrompt = `You are an illustrator generating a single image prompt for one page of a book.
Write a vivid 1-2 sentence description of the scene on this page, suitable for an AI image generator.
The prompt must include the art style, any characters present (by their exact visual descriptions),
the location, and the mood.`;

    if (storyContext) {
      // Characters
      const charBlock =
        storyContext.characters.length > 0
          ? storyContext.characters
              .map((c) => `  • ${c.name} (${c.role}): ${c.visualDescription}`)
              .join("\n")
          : "  none identified";

      // Factions
      const factionBlock =
        storyContext.factions.length > 0
          ? storyContext.factions
              .map((f) => `  • ${f.name} [${f.alignment}]: ${f.visualMarkers}`)
              .join("\n")
          : "  none identified";

      // Locations
      const locationBlock =
        storyContext.locations.length > 0
          ? storyContext.locations
              .map((l) => `  • ${l.name}: ${l.visualDescription}`)
              .join("\n")
          : "  none identified";

      // Key objects
      const objectBlock =
        storyContext.keyObjects.length > 0
          ? storyContext.keyObjects
              .map((o) => `  • ${o.name}: ${o.visualDescription}`)
              .join("\n")
          : "  none";

      // Visual motifs
      const motifBlock =
        storyContext.visualMotifs.length > 0
          ? storyContext.visualMotifs
              .map((m) => `  • ${m.name}: ${m.description}`)
              .join("\n")
          : "  none";

      // Chronology — show what has already happened before this page
      const priorEvents = pageNumber
        ? storyContext.chronology.filter((e) => {
            const match = e.match(/^Page (\d+):/);
            return match ? parseInt(match[1], 10) < pageNumber : true;
          })
        : [];
      const chronologyNote =
        priorEvents.length > 0
          ? `\nEvents already shown (do NOT depict these as if they haven't happened yet):\n${priorEvents.map((e) => `  - ${e}`).join("\n")}`
          : "";

      // Relationships
      const relBlock =
        storyContext.relationships.length > 0
          ? storyContext.relationships.map((r) => `  - ${r}`).join("\n")
          : "  none noted";

      systemPrompt += `

╔══════════════════════════════════════════════════════╗
║              VISUAL BIBLE — FOLLOW EXACTLY           ║
╚══════════════════════════════════════════════════════╝

ART STYLE (use on every page, no exceptions):
  ${storyContext.artStyle}

TONE: ${storyContext.tone}
WORLD SETTING: ${storyContext.setting}
TIME PERIOD: ${storyContext.timePeriod}
STORY ARC: ${storyContext.narrativeSummary}

CHARACTERS — use ONLY these descriptions when a character appears:
${charBlock}

FACTIONS — visual markers to distinguish groups in crowd scenes:
${factionBlock}

LOCATIONS — what each named place looks like:
${locationBlock}

KEY OBJECTS — must look identical every time they appear:
${objectBlock}

RECURRING VISUAL MOTIFS:
${motifBlock}

RELATIONSHIPS (context to avoid placing characters in wrong social roles):
${relBlock}
${chronologyNote}

RULES:
1. Art style is locked. Never use a different style.
2. Character appearances are locked. Do not invent new looks.
3. Factions are visually distinct. Never dress them the same.
4. Respect the chronology — this is page ${pageNumber ?? "?"} and only events up to this page have occurred.
5. If a location is named, use its visual description above.
6. If a key object appears, describe it exactly as above.`;
    } else {
      systemPrompt += `

Maintain visual consistency with previous pages.
Preserve character appearances and settings throughout.`;
    }

    // ── Recent pages for local narrative flow ─────────────────────────────
    let recentBlock = "";
    if (previousContext && previousContext.length > 0) {
      const recent = previousContext.slice(-3);
      recentBlock =
        "\n\nRecent pages (for narrative flow — do not repeat the same scene):\n" +
        recent
          .map(
            (ctx) =>
              `  Page ${ctx.pageNumber}: "${ctx.text.substring(0, 100)}..." → prompt: "${ctx.prompt.substring(0, 80)}..."`
          )
          .join("\n");
    }

    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Generate the image prompt for this page.

${pageNumber ? `Page number: ${pageNumber}\n` : ""}Page text:
"${truncatedText}"
${recentBlock}

Return JSON:
- prompt: 1-2 sentence image generation prompt (include art style, characters by their locked descriptions, location, mood)
- style: art style used
- mood: emotional mood of this specific scene`,
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
    return { prompt: parsed.prompt, style: parsed.style, mood: parsed.mood };
  } catch (error) {
    console.error("Error generating image prompt:", error);
    throw new Error(
      `Prompt generation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate prompts for multiple pages — builds the visual bible first,
 * then generates each prompt in order with full context.
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
      prompts.push({ prompt: "A page from a book", style: "illustration", mood: "neutral" });
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
