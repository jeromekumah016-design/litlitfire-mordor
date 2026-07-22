import { ENV } from "./env";
import { isLLMOffline } from "./offline";
import OpenAI from "openai";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

// Prefer OpenAI if key present (for book->image prompt generation to work with documented env),
// fall back to forge/manus for legacy.
const resolveChatUrl = () => {
  if (ENV.openAiApiKey) {
    return "https://api.openai.com/v1/chat/completions";
  }
  if (ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0) {
    return `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`;
  }
  return "https://api.openai.com/v1/chat/completions"; // default openai
};

const getApiKey = () => {
  if (ENV.openAiApiKey) return ENV.openAiApiKey;
  if (ENV.forgeApiKey) return ENV.forgeApiKey;
  return "";
};

const assertApiKey = () => {
  if (!ENV.openAiApiKey && !ENV.forgeApiKey) {
    throw new Error("OPENAI_API_KEY (or BUILT_IN_FORGE_API_KEY) is not configured");
  }
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

let _openai: OpenAI | null = null;
function getOpenAIForLLM() {
  if (!_openai) {
    const key = ENV.openAiApiKey;
    if (!key) return null;
    _openai = new OpenAI({ apiKey: key });
  }
  return _openai;
}

/** Extract the schema name requested for this call, if any. */
function requestedSchemaName(params: InvokeParams): string | undefined {
  const rf = params.responseFormat || params.response_format;
  if (rf && rf.type === "json_schema") return rf.json_schema?.name;
  const os = params.outputSchema || params.output_schema;
  return os?.name;
}

/** Flatten message content to plain text for offline heuristics. */
function messageText(content: Message["content"]): string {
  const parts = Array.isArray(content) ? content : [content];
  return parts
    .map((p) => (typeof p === "string" ? p : p.type === "text" ? p.text : ""))
    .join(" ");
}

/**
 * Offline LLM stub. Returns deterministic, schema-VALID JSON so every caller
 * parses cleanly with no network and no spend:
 *  - image_prompt  -> a templated prompt derived from the page/scene text.
 *  - story_context -> a minimal-but-valid visual bible (empty entity lists).
 *  - scene_plan    -> empty list, so scenePlanner uses its deterministic
 *                     one-scene-per-page fallback.
 * Any other / no schema -> empty JSON object.
 */
function buildOfflineLLMResult(params: InvokeParams): InvokeResult {
  const schema = requestedSchemaName(params);
  const lastUser = [...params.messages].reverse().find((m) => m.role === "user");
  const userText = lastUser ? messageText(lastUser.content) : "";

  let payload: unknown;
  switch (schema) {
    case "image_prompt": {
      const snippet = userText.replace(/\s+/g, " ").trim().slice(0, 160) || "an empty page";
      payload = {
        prompt: `[offline] Illustration of: ${snippet}`,
        style: "offline placeholder illustration",
        mood: "neutral",
      };
      break;
    }
    case "story_context":
      payload = {
        characters: [],
        factions: [],
        locations: [],
        keyObjects: [],
        chronology: [],
        visualMotifs: [],
        relationships: [],
        tone: "neutral",
        setting: "unspecified",
        timePeriod: "unspecified",
        artStyle: "offline placeholder illustration",
        narrativeSummary: "Offline mode: story context not generated (no LLM call).",
      };
      break;
    case "scene_plan":
      payload = { scenes: [] };
      break;
    case "book_genres": {
      const lower = userText.toLowerCase();
      const genres: string[] = [];
      if (/poem|verse|stanza/.test(lower)) genres.push("poetry");
      if (/chapter|once upon|said |novel|story|captain|riverside/.test(lower)) {
        genres.push("narrative fiction");
      }
      if (/history|according to|study|research/.test(lower)) genres.push("nonfiction");
      if (genres.length === 0) genres.push("literary narrative");
      payload = {
        genres,
        confidence: "low",
        notes: "Offline genre discovery (no LLM).",
      };
      break;
    }
    case "plot_map": {
      const re = /---\s*Page\s+(\d+)\s*---/gi;
      const units: Array<{
        unitIndex: number;
        sourcePageFrom: number;
        sourcePageTo: number;
        role: string;
        title: string;
        rationale: string;
      }> = [];
      const matches: RegExpExecArray[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(userText)) !== null) matches.push(m);
      if (matches.length === 0) {
        const meaningful = userText.trim().length > 40;
        units.push({
          unitIndex: 0,
          sourcePageFrom: 1,
          sourcePageTo: 1,
          role: meaningful ? "main" : "skip",
          title: meaningful ? "Opening" : "Empty",
          rationale: meaningful
            ? "Offline: single main plot unit"
            : "Offline: insufficient text",
        });
      } else {
        for (let i = 0; i < matches.length; i++) {
          const pageNum = parseInt(matches[i][1], 10) || i + 1;
          const start = matches[i].index! + matches[i][0].length;
          const end = i + 1 < matches.length ? matches[i + 1].index! : userText.length;
          const body = userText.slice(start, end).trim();
          const main = body.length > 40;
          units.push({
            unitIndex: i,
            sourcePageFrom: pageNum,
            sourcePageTo: pageNum,
            role: main ? "main" : "skip",
            title: main ? `Plot beat p.${pageNum}` : `Skip p.${pageNum}`,
            rationale: main
              ? "Offline: page has enough narrative text"
              : "Offline: front matter / empty / non-plot",
          });
        }
      }
      payload = {
        authorIntent: "Offline: convey the narrative through key illustrated moments.",
        plotUnits: units,
      };
      break;
    }
    default:
      payload = {};
  }

  return {
    id: `offline-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model: "offline-stub",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(payload) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  if (isLLMOffline()) return buildOfflineLLMResult(params);
  assertApiKey();

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
  } = params;

  // If we have OpenAI key, prefer SDK for reliability with json_schema etc.
  const openai = getOpenAIForLLM();
  if (openai) {
    const formattedMessages = messages.map((m) => {
      const norm = normalizeMessage(m);
      return {
        role: norm.role as any,
        content: norm.content as any,
        ...(norm.name ? { name: norm.name } : {}),
        ...( (norm as any).tool_call_id ? { tool_call_id: (norm as any).tool_call_id } : {}),
      };
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: formattedMessages as any,
      max_tokens: params.maxTokens ?? params.max_tokens ?? 4096,
      ...(tools && tools.length ? { tools: tools as any } : {}),
      ...( (toolChoice || tool_choice) ? { tool_choice: normalizeToolChoice(toolChoice || tool_choice, tools) as any } : {}),
      response_format: normalizeResponseFormat({ responseFormat, response_format, outputSchema, output_schema }) as any,
    });

    return {
      id: completion.id,
      created: completion.created,
      model: completion.model,
      choices: completion.choices.map((c: any, i: number) => ({
        index: i,
        message: {
          role: c.message.role,
          content: c.message.content ?? "",
          tool_calls: c.message.tool_calls,
        },
        finish_reason: c.finish_reason,
      })),
      usage: completion.usage ? {
        prompt_tokens: completion.usage.prompt_tokens,
        completion_tokens: completion.usage.completion_tokens,
        total_tokens: completion.usage.total_tokens,
      } : undefined,
    } as InvokeResult;
  }

  // Fallback to custom/forge endpoint (original behavior)
  const payload: Record<string, unknown> = {
    model: "gemini-2.5-flash",
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  payload.max_tokens = params.maxTokens ?? params.max_tokens ?? 32768;

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const response = await fetch(resolveChatUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  return (await response.json()) as InvokeResult;
}
