import { invokeLLM } from "./_core/llm";

export interface SafetyResult {
  safe: boolean;
  code?: "CSAM" | "VIOLENCE" | "HATE_SPEECH" | "PRIVACY" | "ILLEGAL";
  reason?: string;
}

// Keywords that indicate sexual content involving minors.
// This check runs synchronously before the LLM call so CSAM is always caught
// even if the LLM is unavailable or returns an error.
const CSAM_KEYWORDS = [
  "child porn",
  "childporn",
  "cp porn",
  "loli",
  "shota",
  "underage sex",
  "minor sex",
  "child sex",
  "kiddie porn",
  "infant sex",
  "toddler sex",
  "preteen sex",
  "naked child",
  "nude child",
  "nude minor",
  "naked minor",
  "child nude",
  "child naked",
  "sexual minor",
  "sexual child",
];

function hasCsamKeywords(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return CSAM_KEYWORDS.some((kw) => lower.includes(kw));
}

const VALID_CODES = new Set(["CSAM", "VIOLENCE", "HATE_SPEECH", "PRIVACY", "ILLEGAL"]);

export async function checkPromptSafety(prompt: string): Promise<SafetyResult> {
  // Synchronous CSAM keyword pre-check — never reaches the LLM.
  if (hasCsamKeywords(prompt)) {
    return {
      safe: false,
      code: "CSAM",
      reason: "Prompt contains keywords indicative of child sexual abuse material.",
    };
  }

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a content-safety classifier. Given an image-generation prompt, determine whether it should be blocked for any of the following reasons:

CSAM: The prompt sexualizes or depicts minors (people under 18) in any sexual context.
VIOLENCE: The prompt depicts graphic violence, gore, torture, or extreme bodily harm.
HATE_SPEECH: The prompt promotes hate speech, targeted harassment, or dehumanization based on race, religion, gender, sexual orientation, nationality, or similar protected characteristic.
PRIVACY: The prompt depicts a real, non-public, living individual (e.g., a private citizen) without their implied consent, in a way that could harm them.
ILLEGAL: The prompt could constitute incitement to illegal activity (e.g., detailed instructions for crimes, solicitation of violence against a specific person or group).

If the prompt is safe, return safe=true and leave code and reason empty strings.
If the prompt must be blocked, return safe=false, the single most applicable code, and a brief reason.`,
        },
        {
          role: "user",
          content: `Classify this image-generation prompt:\n\n${prompt}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "safety_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              safe: { type: "boolean" },
              code: { type: "string" },
              reason: { type: "string" },
            },
            required: ["safe", "code", "reason"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = response.choices[0]?.message.content;
    if (!raw) {
      console.warn("[ContentSafety] Empty LLM response — failing open");
      return { safe: true };
    }

    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const parsed = JSON.parse(text) as { safe: boolean; code: string; reason: string };

    if (parsed.safe) {
      return { safe: true };
    }

    const code = parsed.code?.toUpperCase();
    if (!VALID_CODES.has(code)) {
      console.warn(`[ContentSafety] LLM returned unknown code "${parsed.code}" — treating as safe`);
      return { safe: true };
    }

    return {
      safe: false,
      code: code as SafetyResult["code"],
      reason: parsed.reason || "Blocked by content safety policy.",
    };
  } catch (error) {
    console.error("[ContentSafety] LLM call failed — failing open:", error);
    return { safe: true };
  }
}
