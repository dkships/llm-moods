import { describe, expect, it } from "vitest";

import {
  isMaintenanceRequestAllowed,
  isSchedulerRequest,
} from "../../supabase/functions/_shared/runtime";

describe("edge runtime request policy", () => {
  it("blocks public reaggregate maintenance dispatch", () => {
    expect(isMaintenanceRequestAllowed("reaggregate-vibes", false)).toBe(false);
  });

  it("allows internal reaggregate maintenance dispatch", () => {
    expect(isMaintenanceRequestAllowed("reaggregate-vibes", true)).toBe(true);
  });

  it("allows explicit pg_cron scheduler payloads for a matching pipeline", () => {
    expect(isSchedulerRequest({ scheduler: "pg_cron", pipeline: "run-scrapers" }, "run-scrapers")).toBe(true);
    expect(isSchedulerRequest({ scheduler: "pg_cron", pipeline: "scrape-hackernews" }, "scrape-")).toBe(true);
  });

  it("rejects scheduler payloads with the wrong pipeline", () => {
    expect(isSchedulerRequest({ scheduler: "pg_cron", pipeline: "cleanup-old-posts" }, "aggregate-vibes")).toBe(false);
  });
});
