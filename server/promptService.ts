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
 * Generate an image generation prompt from OCR text with context awareness
 * Uses LLM to create a creative, visual description suitable for image generation
 * Considers previous pages for narrative continuity and visual consistency
 */
export async function generateImagePrompt(
  ocrText: string,
  pageNumber?: number,
  previousContext?: PageContext[]
): Promise<GeneratedPrompt> {
  try {
    if (!ocrText || ocrText.trim().length === 0) {
      return {
        prompt: "A blank page with minimal content",
        style: "minimalist",
        mood: "calm",
      };
    }

    // Truncate text to reasonable length for LLM
    const truncatedText = ocrText.substring(0, 500);

    // Build context from previous pages if available
    let contextMessage = "";
    if (previousContext && previousContext.length > 0) {
      const recentContext = previousContext.slice(-3); // Use last 3 pages for context
      contextMessage = `

Context from previous pages:
${recentContext
  .map(
    (ctx) =>
      `Page ${ctx.pageNumber}: "${ctx.text.substring(0, 150)}..."
Visual theme: ${ctx.prompt.substring(0, 100)}...${
        ctx.characters ? `\nCharacters: ${ctx.characters.join(", ")}` : ""
      }${ctx.setting ? `\nSetting: ${ctx.setting}` : ""}`
  )
  .join("\n\n")}`;
    }

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a creative prompt engineer for book illustration specializing in visual narrative consistency.
Given text from a book page, generate a vivid, visual description that captures the essence and mood of the text.
The prompt should be suitable for an AI image generator like DALL-E or Midjourney.
Keep it concise but evocative (1-2 sentences).
Also identify the style, mood, main characters, and setting in separate fields.

CRITICAL INSTRUCTIONS FOR CONTEXT-AWARE GENERATION:
- If context from previous pages is provided, maintain visual and thematic consistency
- Preserve character appearances, names, and descriptions across pages
- Keep the same artistic style and color palette for visual cohesion
- Consider the narrative flow and emotional arc of the story
- Build upon established settings and atmospheres
- Ensure character interactions and relationships remain consistent
- Use visual callbacks to previous scenes when appropriate`,
        },
        {
          role: "user",
          content: `Generate an image generation prompt for this book page text:

"${truncatedText}"${pageNumber ? `

This is page ${pageNumber}.` : ""}${contextMessage}

Return a JSON response with:
- prompt: The visual description (1-2 sentences)
- style: Artistic style (e.g., 'oil painting', 'watercolor', 'digital art')
- mood: Mood/atmosphere (e.g., 'mysterious', 'joyful', 'dark')
- characters: Array of character names/descriptions mentioned
- setting: Location/environment description`,
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
              prompt: {
                type: "string",
                description:
                  "The visual description prompt for image generation (1-2 sentences)",
              },
              style: {
                type: "string",
                description:
                  "The artistic style (e.g., 'oil painting', 'watercolor', 'digital art')",
              },
              mood: {
                type: "string",
                description:
                  "The mood or atmosphere (e.g., 'mysterious', 'joyful', 'dark')",
              },
              characters: {
                type: "array",
                items: {
                  type: "string",
                },
                description: "Main characters mentioned in this page",
              },
              setting: {
                type: "string",
                description: "The location or environment of this page",
              },
            },
            required: ["prompt"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message.content;
    if (!content) {
      throw new Error("No response from LLM");
    }

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
 * Generate prompts for multiple pages with full context awareness
 * Builds context progressively as pages are processed
 */
export async function generateImagePromptsWithContext(
  ocrTexts: string[]
): Promise<GeneratedPrompt[]> {
  const prompts: GeneratedPrompt[] = [];
  const pageContexts: PageContext[] = [];

  for (let i = 0; i < ocrTexts.length; i++) {
    try {
      const pageNumber = i + 1;
      const prompt = await generateImagePrompt(
        ocrTexts[i],
        pageNumber,
        pageContexts.length > 0 ? pageContexts : undefined
      );
      prompts.push(prompt);

      // Store context for next pages
      pageContexts.push({
        pageNumber,
        text: ocrTexts[i],
        prompt: prompt.prompt,
        characters: extractCharacters(ocrTexts[i]),
        setting: prompt.mood,
      });

      // Add small delay between requests to avoid rate limiting
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

/**
 * Generate prompts for multiple pages (legacy function for backward compatibility)
 */
export async function generateImagePrompts(ocrTexts: string[]): Promise<GeneratedPrompt[]> {
  return generateImagePromptsWithContext(ocrTexts);
}

/**
 * Extract potential character names from text
 * Simple heuristic-based extraction
 */
function extractCharacters(text: string): string[] {
  const characters: string[] = [];
  // Look for capitalized words that might be names
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  const matches = text.match(namePattern) || [];

  // Filter out common words
  const commonWords = new Set([
    "The",
    "And",
    "But",
    "For",
    "With",
    "From",
    "That",
    "This",
    "Which",
    "When",
    "Where",
    "Why",
    "How",
  ]);

  matches.forEach((match) => {
    if (!commonWords.has(match) && characters.length < 5) {
      characters.push(match);
    }
  });

  // Remove duplicates
  const uniqueCharacters: string[] = [];
  const seen = new Set<string>();
  for (const char of characters) {
    if (!seen.has(char)) {
      uniqueCharacters.push(char);
      seen.add(char);
    }
  }
  return uniqueCharacters;
}
