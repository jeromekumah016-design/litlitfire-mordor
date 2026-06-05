/**
 * Tolerant JSON extraction for LLM responses.
 *
 * When invokeLLM targets the OpenAI API with a strict json_schema, the content
 * is already clean JSON. But LLM_MODEL / OPENAI_BASE_URL are configurable, and
 * many OpenAI-compatible gateways or smaller models ignore strict mode and wrap
 * the JSON in ```json fences or surround it with prose. This helper recovers the
 * JSON object in those cases instead of throwing.
 */
export function parseLlmJson<T = unknown>(content: string): T {
  const trimmed = content.trim();

  // 1. Fast path — already valid JSON.
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through to recovery strategies
  }

  // 2. Strip a fenced code block: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    try {
      return JSON.parse(inner) as T;
    } catch {
      // fall through
    }
  }

  // 3. Extract the first balanced {...} object (handles surrounding prose and
  //    braces inside string literals).
  const objStr = extractFirstJsonObject(trimmed);
  if (objStr) {
    return JSON.parse(objStr) as T;
  }

  throw new Error(
    `Could not parse JSON from LLM response: ${trimmed.slice(0, 200)}`
  );
}

/** Returns the first complete top-level {...} substring, or null. */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}
