import { invokeLLM } from "./_core/llm";

export interface GeneratedPrompt {
  prompt: string;
  style?: string;
  mood?: string;
}

/**
 * Generate an image generation prompt from OCR text
 * Uses LLM to create a creative, visual description suitable for image generation
 */
export async function generateImagePrompt(ocrText: string, pageNumber?: number): Promise<GeneratedPrompt> {
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

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a creative prompt engineer for image generation. 
Given text from a book page, generate a vivid, visual description that captures the essence and mood of the text.
The prompt should be suitable for an AI image generator like DALL-E or Midjourney.
Keep it concise but evocative (1-2 sentences).
Also identify the style and mood in separate fields.`,
        },
        {
          role: "user",
          content: `Generate an image generation prompt for this book page text:\n\n"${truncatedText}"${pageNumber ? `\n\nThis is page ${pageNumber}.` : ""}`,
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
                description: "The visual description prompt for image generation",
              },
              style: {
                type: "string",
                description: "The artistic style (e.g., 'oil painting', 'watercolor', 'digital art')",
              },
              mood: {
                type: "string",
                description: "The mood or atmosphere (e.g., 'mysterious', 'joyful', 'dark')",
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
    throw new Error(`Prompt generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generate prompts for multiple pages (sequential to avoid rate limits)
 */
export async function generateImagePrompts(ocrTexts: string[]): Promise<GeneratedPrompt[]> {
  const prompts: GeneratedPrompt[] = [];

  for (let i = 0; i < ocrTexts.length; i++) {
    try {
      const prompt = await generateImagePrompt(ocrTexts[i], i + 1);
      prompts.push(prompt);
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
