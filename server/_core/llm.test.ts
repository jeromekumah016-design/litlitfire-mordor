import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These tests lock in the self-hosted OpenAI migration of invokeLLM:
 * it must target an OpenAI-compatible /v1/chat/completions endpoint, send the
 * configured model + bearer key, and never re-introduce Manus Forge specifics
 * (the `thinking` budget param or a hardcoded gemini model).
 */
describe("invokeLLM (OpenAI chat completions)", () => {
  const okResponse = {
    id: "cmpl-1",
    created: 0,
    model: "gpt-4o-mini",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "hello" },
        finish_reason: "stop",
      },
    ],
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "https://api.openai.com";
    process.env.LLM_MODEL = "gpt-4o-mini";
    delete process.env.LLM_MAX_TOKENS;

    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => okResponse,
      text: async () => JSON.stringify(okResponse),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function callInvoke(extra: Record<string, unknown> = {}) {
    const { invokeLLM } = await import("./llm");
    return invokeLLM({
      messages: [{ role: "user", content: "hi" }],
      ...extra,
    } as any);
  }

  it("posts to the OpenAI chat completions endpoint with bearer auth", async () => {
    await callInvoke();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer test-key");
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("sends the configured model and no Manus-specific params", async () => {
    await callInvoke();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body).not.toHaveProperty("thinking");
    expect(body.model).not.toMatch(/gemini/i);
  });

  it("defaults max_tokens from env and honors an explicit override", async () => {
    await callInvoke();
    const defaultBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(defaultBody.max_tokens).toBe(4096);

    fetchMock.mockClear();
    await callInvoke({ maxTokens: 256 });
    const overrideBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(overrideBody.max_tokens).toBe(256);
  });

  it("forwards a json_schema response_format unchanged", async () => {
    await callInvoke({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "thing",
          strict: true,
          schema: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("thing");
  });

  it("throws a descriptive error when the API key is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(callInvoke()).rejects.toThrow(/OPENAI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces non-ok responses with status and body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limited",
      json: async () => ({}),
    } as any);

    await expect(callInvoke()).rejects.toThrow(/429.*rate limited/s);
  });
});
