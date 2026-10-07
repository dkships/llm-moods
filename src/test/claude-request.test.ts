import { afterEach, describe, expect, it, vi } from "vitest";

import {
  claudeBudgetFields,
  claudeToolChoice,
  defaultToolChoice,
  readToolInput,
} from "../../supabase/functions/_shared/claude-request";
import {
  RUMOR_DEFAULT_MODEL,
  rumorRequestBody,
} from "../../supabase/functions/_shared/rumor-extract";
import { classifyBatch } from "../../supabase/functions/_shared/classifier";

afterEach(() => {
  vi.unstubAllGlobals();
});

const TOOL = "record_rumors";

describe("claudeToolChoice", () => {
  it("forces the tool where the model accepts it", () => {
    expect(claudeToolChoice("claude-haiku-5-5", TOOL, "forced")).toEqual({ type: "tool", name: TOOL });
    expect(claudeToolChoice("claude-haiku-4-5-20251001", TOOL, "forced")).toEqual({ type: "tool", name: TOOL });
  });

  it("falls back to auto on models that 400 on forced tool_choice", () => {
    for (const model of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]) {
      expect(claudeToolChoice(model, TOOL, "forced")).toEqual({ type: "auto" });
    }
  });
});

describe("defaultToolChoice", () => {
  it("lets thinking models think before the call and keeps Haiku 4.5 forced", () => {
    expect(defaultToolChoice("claude-haiku-5-5")).toBe("auto");
    expect(defaultToolChoice("claude-haiku-4-5-20251001")).toBe("forced");
  });
});

describe("claudeBudgetFields", () => {
  it("never sends effort to Haiku 4.5, which rejects the field", () => {
    expect(claudeBudgetFields("claude-haiku-4-5-20251001", 8000, "low", { type: "tool" })).toEqual({ max_tokens: 8000 });
  });

  it("adds thinking headroom only when the model can think before the call", () => {
    const forced = claudeBudgetFields("claude-haiku-5-5", 8000, "low", { type: "tool" });
    const auto = claudeBudgetFields("claude-haiku-5-5", 8000, "medium", { type: "auto" });
    expect(forced).toEqual({ max_tokens: 8000, output_config: { effort: "low" } });
    expect(auto.output_config).toEqual({ effort: "medium" });
    expect(auto.max_tokens as number).toBeGreaterThan(8000);
  });
});

describe("readToolInput", () => {
  it("finds the tool call behind leading thinking blocks", () => {
    const read = readToolInput({
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Recording." },
        { type: "tool_use", name: TOOL, input: { posts: [] } },
      ],
    }, TOOL);
    expect(read).toEqual({ input: { posts: [] } });
  });

  it("reports a refusal before reading content", () => {
    const read = readToolInput({
      stop_reason: "refusal",
      stop_details: { category: "cyber" },
      content: [{ type: "tool_use", name: TOOL, input: { posts: [] } }],
    }, TOOL);
    expect(read).toMatchObject({ kind: "refusal", failure: "refusal (cyber)" });
  });

  it("separates truncation from a skipped tool call", () => {
    const thinkingOnly = [{ type: "thinking", thinking: "", signature: "sig" }];
    expect(readToolInput({ stop_reason: "max_tokens", content: thinkingOnly }, TOOL)).toMatchObject({ kind: "truncated" });
    expect(readToolInput({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] }, TOOL))
      .toMatchObject({ kind: "no_tool_call" });
  });
});

describe("rumorRequestBody", () => {
  it("defaults to Haiku 5.5 without a dated id, sampling params, or prefill", () => {
    const body = rumorRequestBody(RUMOR_DEFAULT_MODEL, "POST 0 [x, today]: hi");
    expect(RUMOR_DEFAULT_MODEL).toBe("claude-haiku-5-5");
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect((body.messages as { content: string }[])[0].content).toContain("record_rumors");
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.fallbacks).toBeUndefined();
    expect(body.output_config).toMatchObject({ effort: expect.any(String) });

    const messages = body.messages as { role: string }[];
    expect(messages[messages.length - 1]?.role).toBe("user");
    const system = body.system as { cache_control?: unknown }[];
    expect(system[0].cache_control).toMatchObject({ type: "ephemeral" });
  });

  it("uses auto tool_choice with thinking headroom on Sonnet 5.5", () => {
    const body = rumorRequestBody("claude-sonnet-5-5", "POST 0: hi", { effort: "medium" });
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.max_tokens as number).toBeGreaterThan(8000);
  });

  it("keeps the Haiku 4.5 rollback request valid", () => {
    const body = rumorRequestBody("claude-haiku-4-5-20251001", "POST 0: hi");
    expect(body.output_config).toBeUndefined();
    expect(body.tool_choice).toEqual({ type: "tool", name: TOOL });
  });
});

describe("Anthropic classifier path on 5.5-generation models", () => {
  const classification = {
    relevant: true,
    sentiment: "positive",
    complaint_category: null,
    praise_category: "output_quality",
    confidence: 0.9,
    language: null,
    english_translation: null,
  };

  function reply(body: unknown) {
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  it("sends auto tool_choice and effort to Sonnet 5.5 and reads past thinking blocks", async () => {
    const fetchMock = vi.fn(async () => reply({
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "tool_use", name: "record_classifications", input: { results: [classification, classification] } },
      ],
      usage: { input_tokens: 100, output_tokens: 40 },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await classifyBatch(["a", "b"], "k", 25, vi.fn(async () => {}), { model: "claude-sonnet-5-5" });

    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.tool_choice).toEqual({ type: "auto" });
    expect(sent.output_config).toMatchObject({ effort: expect.any(String) });
    expect(sent.messages[0].content).toContain("record_classifications");
    expect(results.map((r) => r.status)).toEqual(["classified", "classified"]);
  });

  it("asks again when an auto call answers in text instead of the tool", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ stop_reason: "end_turn", content: [{ type: "text", text: "Here you go" }] }))
      .mockResolvedValueOnce(reply({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "record_classifications", input: { results: [classification, classification] } }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await classifyBatch(["a", "b"], "k", 25, vi.fn(async () => {}), { model: "claude-opus-5-5" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.status)).toEqual(["classified", "classified"]);
  });

  it("places post-keyed batch results by key, not by array position", async () => {
    const negative = { ...classification, sentiment: "negative", praise_category: null, complaint_category: "speed" };
    vi.stubGlobal("fetch", vi.fn(async () => reply({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "record_classifications", input: { results: [{ post: 2, ...negative }, { post: 1, ...classification }] } }],
    })));

    const results = await classifyBatch(["good", "slow"], "k", 25, vi.fn(async () => {}), { model: "claude-haiku-5-5" });

    expect(results.map((r) => r.sentiment)).toEqual(["positive", "negative"]);
  });

  it("retries one post at a time when a post number repeats", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "record_classifications", input: { results: [{ post: 1, ...classification }, { post: 1, ...classification }] } }],
      }))
      .mockImplementation(async () => reply({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "record_classifications", input: { results: [{ post: 1, ...classification }] } }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await classifyBatch(["a", "b"], "k", 25, vi.fn(async () => {}), { model: "claude-haiku-5-5" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results.map((r) => r.status)).toEqual(["classified", "classified"]);
  });

  it("turns a refusal into a classifier_error without retrying", async () => {
    const fetchMock = vi.fn(async () => reply({ stop_reason: "refusal", stop_details: { category: "general_harms" }, content: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await classifyBatch(["a", "b"], "k", 25, vi.fn(async () => {}), { model: "claude-haiku-5-5" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ status: "classifier_error", error_type: "refusal" });
  });
});

describe("OpenAI reasoning_effort default", () => {
  function openAiReply() {
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ results: [{ relevant: false }, { relevant: false }] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  it("sends low to gpt-6.1-sol, which 400s on none, and keeps none for gpt-6-sol", async () => {
    const fetchMock = vi.fn(async () => openAiReply());
    vi.stubGlobal("fetch", fetchMock);

    await classifyBatch(["a", "b"], "k", 25, vi.fn(async () => {}), { model: "gpt-6.1-sol" });
    await classifyBatch(["a", "b"], "k", 25, vi.fn(async () => {}), { model: "gpt-6-sol" });

    const sent = fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(sent[0].reasoning_effort).toBe("low");
    expect(sent[1].reasoning_effort).toBe("none");
  });
});
