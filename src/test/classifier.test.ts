import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyBatch,
  isClassifierFailure,
  summarizeClassifierFailures,
} from "../../supabase/functions/_shared/classifier";

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
});
