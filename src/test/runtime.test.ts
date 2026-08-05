import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasSchedulerBodyShape,
  isMaintenanceRequestAllowed,
} from "../../supabase/functions/_shared/runtime";

const TOKEN = "a".repeat(64);

// runtime.ts caches the token in module scope, so each token test needs a fresh
// module instance.
async function loadRuntimeWith(fetchImpl: typeof fetch) {
  vi.resetModules();
  vi.stubGlobal("Deno", {
    env: {
      get: (name: string) =>
        ({
          SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        })[name],
    },
  });
  vi.stubGlobal("fetch", fetchImpl);
  return await import("../../supabase/functions/_shared/runtime");
}

function tokenRowResponse(token: string | null) {
  return vi.fn(async () =>
    new Response(JSON.stringify(token === null ? [] : [{ token }]), { status: 200 })
  ) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("edge runtime request policy", () => {
  it("blocks public reaggregate maintenance dispatch", () => {
    expect(isMaintenanceRequestAllowed("reaggregate-vibes", false)).toBe(false);
  });

  it("allows internal reaggregate maintenance dispatch", () => {
    expect(isMaintenanceRequestAllowed("reaggregate-vibes", true)).toBe(true);
  });

  it("recognises pg_cron body shape for a matching pipeline", () => {
    expect(hasSchedulerBodyShape({ scheduler: "pg_cron", pipeline: "run-scrapers" }, "run-scrapers")).toBe(true);
    expect(hasSchedulerBodyShape({ scheduler: "pg_cron", pipeline: "scrape-hackernews" }, "scrape-")).toBe(true);
  });

  it("rejects scheduler payloads with the wrong pipeline", () => {
    expect(hasSchedulerBodyShape({ scheduler: "pg_cron", pipeline: "cleanup-old-posts" }, "aggregate-vibes")).toBe(false);
  });
});

describe("scheduler token gate", () => {
  it("accepts a pg_cron payload carrying the matching token", async () => {
    const { isSchedulerRequest } = await loadRuntimeWith(tokenRowResponse(TOKEN));
    await expect(
      isSchedulerRequest({ scheduler: "pg_cron", pipeline: "scrape-hackernews", token: TOKEN }, "scrape-"),
    ).resolves.toBe(true);
  });

  // The regression that took the pipeline down: correct shape, no token.
  it("rejects a correctly shaped payload with no token", async () => {
    const { isSchedulerRequest } = await loadRuntimeWith(tokenRowResponse(TOKEN));
    await expect(
      isSchedulerRequest({ scheduler: "pg_cron", pipeline: "scrape-hackernews" }, "scrape-"),
    ).resolves.toBe(false);
  });

  it("rejects a wrong token of the same length", async () => {
    const { isSchedulerRequest } = await loadRuntimeWith(tokenRowResponse(TOKEN));
    await expect(
      isSchedulerRequest(
        { scheduler: "pg_cron", pipeline: "scrape-hackernews", token: "b".repeat(64) },
        "scrape-",
      ),
    ).resolves.toBe(false);
  });

  it("fails closed when the token table is missing", async () => {
    const missing = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const { isSchedulerRequest } = await loadRuntimeWith(missing);
    await expect(
      isSchedulerRequest({ scheduler: "pg_cron", pipeline: "scrape-hackernews", token: TOKEN }, "scrape-"),
    ).resolves.toBe(false);
  });

  it("does not hit the token lookup when the body shape is wrong", async () => {
    const spy = tokenRowResponse(TOKEN);
    const { isSchedulerRequest } = await loadRuntimeWith(spy);
    await expect(
      isSchedulerRequest({ scheduler: "pg_cron", pipeline: "cleanup-old-posts", token: TOKEN }, "scrape-"),
    ).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
