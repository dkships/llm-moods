import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyBatch } from "../../supabase/functions/_shared/classifier";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// claim_api_quota was dropped on 2026-08-22. With Supabase env present (as in
// every deployed edge function), the Gemini path must go straight to the
// Gemini API instead of gating on the missing RPC.
describe("Gemini path without the dropped quota RPC", () => {
  it("calls the Gemini API when Supabase env is configured", async () => {
    const env: Record<string, string> = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    };
    vi.stubGlobal("Deno", { env: { get: (name: string) => env[name] } });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await classifyBatch(["Gemini is great today"], "gemini-key", 25, undefined, { model: "gemini-2.5-flash" });

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.includes("generativelanguage.googleapis.com"))).toBe(true);
  });
});
