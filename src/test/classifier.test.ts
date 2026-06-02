import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyBatch,
  isClassifierFailure,
  summarizeClassifierFailures,
} from "../../supabase/functions/_shared/classifier";
import {
  isLikelyNonExperienceShare,
  isLikelyPromotionalShare,
} from "../../supabase/functions/_shared/utils";
import {
  buildClassificationStateUpdate,
  processPendingClassifications,
} from "../../supabase/functions/_shared/classification-state";
import { providerForModel } from "../../supabase/functions/_shared/classifier";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Gemini classifier failure handling", () => {
  it("returns a request-level quota deferral for Gemini 429 responses", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for Gemini API requests.",
        details: [
          {
            violations: [
              {
                quotaMetric: "GenerateRequestsPerMinutePerProjectPerModel",
                quotaId: "free_tier_requests_per_minute",
              },
            ],
          },
        ],
      },
    }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "x-ratelimit-limit-requests": "10",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const logError = vi.fn(async () => {});

    const results = await classifyBatch([
      "ChatGPT is broken today",
      "Claude is refusing everything",
    ], "test-key", 25, logError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results.every(isClassifierFailure)).toBe(true);
    expect(results.every((result) => result.status === "quota_deferred")).toBe(true);
    expect(new Set(results.map((result) => result.request_error_id)).size).toBe(1);
    expect(results[0].error).toContain("RESOURCE_EXHAUSTED");
    expect(results[0].error).toContain("GenerateRequestsPerMinutePerProjectPerModel");
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("Gemini request quota deferred"),
      "classify-request-quota",
    );

    const summary = summarizeClassifierFailures(results);
    expect(summary.candidateFailures).toBe(2);
    expect(summary.requestFailures).toBe(1);
    expect(summary.quotaDeferred).toBe(2);
    expect(summary.messages[0]).toContain("across 1 request");
  });

  it("stops later batches after the first quota deferral", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Daily quota exceeded.",
      },
    }), { status: 429, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await classifyBatch(
      Array.from({ length: 30 }, (_, i) => `Claude quota test ${i}`),
      "test-key",
      25,
      vi.fn(async () => {}),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(30);
    expect(results.every((result) => result.status === "quota_deferred")).toBe(true);
    expect(new Set(results.map((result) => result.request_error_id)).size).toBe(1);
  });
});

describe("scraper relevance prefilters", () => {
  it("filters obvious ads and promotional CTA posts", () => {
    expect(isLikelyPromotionalShare(
      "[\uAD11\uACE0] Claude workflow template",
      "Book a coffee date to learn more https://example.com",
    )).toBe(true);
  });

  it("filters launch or integration announcements without direct model-quality experience", () => {
    expect(isLikelyNonExperienceShare(
      "Adobe just became an API call for Claude",
      "New integration announced today https://example.com",
    )).toBe(true);
  });

  it("keeps first-person model experience posts", () => {
    expect(isLikelyNonExperienceShare(
      "Claude Code has been excellent this week",
      "I hooked up Claude to a multi-file refactor and it kept context better than ChatGPT.",
    )).toBe(false);
  });

  it("keeps first-person experience posts even when they include CTA language and a URL", () => {
    expect(isLikelyPromotionalShare(
      "Claude refactor notes",
      "I tested Claude on this refactor and it kept context across files. Learn more: https://example.com",
    )).toBe(false);
  });
});

describe("model mention classification state", () => {
  const now = new Date("2026-05-08T16:00:00.000Z");

  it("moves pending mentions to classified with sentiment fields", () => {
    const update = buildClassificationStateUpdate(
      { classification_attempts: 0 },
      {
        relevant: true,
        sentiment: "negative",
        complaint_category: "reasoning",
        praise_category: null,
        confidence: 0.91,
        status: "classified",
        error: null,
      },
      { now, classifierVersion: "test-v1" },
    );

    expect(update).toMatchObject({
      classification_status: "classified",
      classification_attempts: 1,
      classifier_version: "test-v1",
      sentiment: "negative",
      complaint_category: "reasoning",
      confidence: 0.91,
    });
  });

  it("moves non-relevant mentions to irrelevant", () => {
    const update = buildClassificationStateUpdate(
      { classification_attempts: 1 },
      {
        relevant: false,
        sentiment: null,
        complaint_category: null,
        praise_category: null,
        confidence: 0,
        status: "irrelevant",
        error: null,
      },
      { now },
    );

    expect(update).toMatchObject({
      classification_status: "irrelevant",
      classification_attempts: 2,
      sentiment: null,
      confidence: 0,
    });
  });

  it("moves transient classifier failures to retry", () => {
    const update = buildClassificationStateUpdate(
      { classification_attempts: 0 },
      {
        relevant: false,
        sentiment: null,
        complaint_category: null,
        praise_category: null,
        confidence: 0,
        status: "quota_deferred",
        error: "minute_limit",
        retry_after_ms: 30_000,
      },
      { now },
    );

    expect(update).toMatchObject({
      classification_status: "retry",
      classification_attempts: 1,
      last_classification_error: "minute_limit",
    });
    expect(update.next_classification_at).toBe("2026-05-08T16:00:30.000Z");
  });
});

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

function anthropicToolUseResponse(results: unknown[]) {
  return new Response(JSON.stringify({
    content: [{ type: "tool_use", name: "record_classifications", input: { results } }],
    usage: { input_tokens: 120, output_tokens: 60, cache_read_input_tokens: 0 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("provider routing", () => {
  it("routes by model-id prefix", () => {
    expect(providerForModel("claude-sonnet-4-6")).toBe("anthropic");
    expect(providerForModel("claude-haiku-4-5-20251001")).toBe("anthropic");
    expect(providerForModel("gemini-2.5-flash")).toBe("gemini");
    expect(providerForModel("gemini-3-flash-preview")).toBe("gemini");
  });
});

describe("Anthropic classifier path", () => {
  it("sends a claude-* model to the Anthropic Messages API and parses tool_use output", async () => {
    const fetchMock = vi.fn(async () => anthropicToolUseResponse([
      { relevant: true, sentiment: "positive", complaint_category: null, praise_category: "output_quality", confidence: 0.92, language: null, english_translation: null },
      { relevant: true, sentiment: "negative", complaint_category: "reasoning", praise_category: null, confidence: 0.81, language: null, english_translation: null },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const results = await classifyBatch(
      ["Claude is great at code", "Claude flubbed the reasoning"],
      "anthropic-key",
      25,
      vi.fn(async () => {}),
      { model: CLAUDE_MODEL },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("anthropic-key");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBeTruthy();
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.model).toBe(CLAUDE_MODEL);
    expect(sentBody.tool_choice).toMatchObject({ type: "tool" });
    // Strict tool use: grammar-constrained, schema-valid output.
    expect(sentBody.tools[0].strict).toBe(true);
    // Strict subset rejects numeric minimum/maximum on the confidence field.
    expect(sentBody.tools[0].input_schema.properties.results.items.properties.confidence.minimum).toBeUndefined();
    // Current Claude models reject `temperature` — it must not be sent.
    expect(sentBody.temperature).toBeUndefined();
    // Static instruction prefix is in the cached system block, not the user turn.
    expect(sentBody.system[0].cache_control).toMatchObject({ type: "ephemeral" });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ sentiment: "positive", status: "classified" });
    expect(results[1]).toMatchObject({ sentiment: "negative", complaint_category: "reasoning", status: "classified" });
  });

  it("defers (not fails) a 429 with no retry-after so the post is retried later", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const results = await classifyBatch(
      ["Claude post a", "Claude post b"],
      "anthropic-key",
      25,
      vi.fn(async () => {}),
      { model: CLAUDE_MODEL },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === "quota_deferred")).toBe(true);
  });

  it("marks a missing batch result as parse_error (retryable), not terminal irrelevant", async () => {
    // Model returns only 1 result for a 2-post batch (truncation/omission).
    const fetchMock = vi.fn(async () => anthropicToolUseResponse([
      { relevant: true, sentiment: "positive", complaint_category: null, praise_category: "output_quality", confidence: 0.9, language: null, english_translation: null },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const results = await classifyBatch(
      ["Claude a", "Claude b"],
      "anthropic-key",
      25,
      vi.fn(async () => {}),
      { model: CLAUDE_MODEL },
    );

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("classified");
    expect(results[1].status).toBe("parse_error");
    expect(isClassifierFailure(results[1])).toBe(true);
  });

  it("runs Anthropic batches concurrently and assembles results in positional order", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const userText = JSON.parse(init.body as string).messages[0].content as string;
      const isA = userText.includes('"a"');
      return anthropicToolUseResponse([
        isA
          ? { relevant: true, sentiment: "positive", complaint_category: null, praise_category: "output_quality", confidence: 0.9, language: null, english_translation: null }
          : { relevant: true, sentiment: "negative", complaint_category: "speed", praise_category: null, confidence: 0.8, language: null, english_translation: null },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    // batchSize 1 → two batches; they fan out concurrently but must stay aligned.
    const results = await classifyBatch(["a", "b"], "anthropic-key", 1, vi.fn(async () => {}), { model: CLAUDE_MODEL });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results[0].sentiment).toBe("positive");
    expect(results[1].sentiment).toBe("negative");
  });
});

describe("free-Gemini spillover", () => {
  interface MockUpdate { id: string; values: Record<string, unknown>; }

  function mockSupabase(rows: unknown[], updates: MockUpdate[]) {
    const builder = {
      select: () => builder,
      in: () => builder,
      or: () => builder,
      order: () => builder,
      limit: async () => ({ data: rows, error: null }),
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          updates.push({ id, values });
          return { error: null };
        },
      }),
    };
    return { from: () => builder } as never;
  }

  const claudeRows = [
    { id: "1", model_id: "m", title: "t1", content: "Claude nailed this refactor", source_url: null, classification_attempts: 0, models: { slug: "claude" } },
    { id: "2", model_id: "m", title: "t2", content: "Claude kept hallucinating", source_url: null, classification_attempts: 0, models: { slug: "claude" } },
  ];

  function stubClaudeEnv() {
    vi.stubGlobal("Deno", {
      env: {
        get: (k: string) => (({
          CLASSIFIER_MODEL: CLAUDE_MODEL,
          ANTHROPIC_API_KEY: "ak",
          GEMINI_FREE_API_KEY: "gk",
        } as Record<string, string>)[k]),
      },
    });
  }

  const geminiSuccess = () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ results: [
      { relevant: true, sentiment: "positive", complaint_category: null, praise_category: "output_quality", confidence: 0.9, language: null, english_translation: null },
      { relevant: true, sentiment: "negative", complaint_category: "hallucinations", praise_category: null, confidence: 0.85, language: null, english_translation: null },
    ] }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const hardFailure = (vendor: "anthropic" | "gemini") => new Response(
    JSON.stringify(vendor === "anthropic"
      ? { type: "error", error: { type: "api_error", message: "boom" } }
      : { error: { code: 400, status: "INVALID_ARGUMENT", message: "boom" } }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );

  it("recovers transient Claude errors through the free Gemini key", async () => {
    stubClaudeEnv();
    const fetchMock = vi.fn(async (url: unknown) =>
      String(url).includes("api.anthropic.com") ? hardFailure("anthropic") : geminiSuccess());
    vi.stubGlobal("fetch", fetchMock);

    const updates: MockUpdate[] = [];
    const summary = await processPendingClassifications(mockSupabase(claudeRows, updates), "ak", {
      limit: 10,
      batchSize: 20,
      logError: vi.fn(async () => {}),
    });

    expect(summary.classified).toBe(2);
    expect(summary.retry).toBe(0);
    expect(updates).toHaveLength(2);
    expect(updates.every((u) => u.values.classification_status === "classified")).toBe(true);
  });

  it("leaves un-recovered items in retry when the free Gemini fallback also fails", async () => {
    stubClaudeEnv();
    const fetchMock = vi.fn(async (url: unknown) =>
      hardFailure(String(url).includes("api.anthropic.com") ? "anthropic" : "gemini"));
    vi.stubGlobal("fetch", fetchMock);

    const updates: MockUpdate[] = [];
    const summary = await processPendingClassifications(mockSupabase(claudeRows, updates), "ak", {
      limit: 10,
      batchSize: 20,
      logError: vi.fn(async () => {}),
    });

    expect(summary.classified).toBe(0);
    expect(summary.retry).toBe(2);
    expect(updates.every((u) => u.values.classification_status === "retry")).toBe(true);
  });
});
