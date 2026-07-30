import { describe, expect, it } from "vitest";
import { parseLlmJson } from "./llmJson";

describe("parseLlmJson", () => {
  it("parses clean JSON", () => {
    expect(parseLlmJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  it("parses JSON with surrounding whitespace", () => {
    expect(parseLlmJson('  \n {"ok": true} \n ')).toEqual({ ok: true });
  });

  it("strips ```json fenced code blocks", () => {
    const content = 'Here is the result:\n```json\n{"prompt":"a castle"}\n```';
    expect(parseLlmJson(content)).toEqual({ prompt: "a castle" });
  });

  it("strips bare ``` fenced code blocks", () => {
    const content = "```\n{\"mood\":\"calm\"}\n```";
    expect(parseLlmJson(content)).toEqual({ mood: "calm" });
  });

  it("extracts a JSON object surrounded by prose", () => {
    const content =
      'Sure! {"style":"oil painting","mood":"epic"} — hope that helps.';
    expect(parseLlmJson(content)).toEqual({
      style: "oil painting",
      mood: "epic",
    });
  });

  it("handles braces inside string values", () => {
    const content = 'noise {"text":"a {nested} brace","n":2} trailing';
    expect(parseLlmJson(content)).toEqual({ text: "a {nested} brace", n: 2 });
  });

  it("handles escaped quotes inside strings", () => {
    const content = '{"quote":"she said \\"hi\\"","ok":true}';
    expect(parseLlmJson(content)).toEqual({ quote: 'she said "hi"', ok: true });
  });

  it("parses nested objects/arrays", () => {
    const content = '```json\n{"a":{"b":[1,2,{"c":3}]}}\n```';
    expect(parseLlmJson(content)).toEqual({ a: { b: [1, 2, { c: 3 }] } });
  });

  it("throws a descriptive error when no JSON is present", () => {
    expect(() => parseLlmJson("I refuse to answer.")).toThrow(/Could not parse JSON/);
  });
});
