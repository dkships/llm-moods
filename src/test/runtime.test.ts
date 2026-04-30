import { describe, expect, it } from "vitest";

import { isMaintenanceRequestAllowed } from "../../supabase/functions/_shared/runtime";

describe("edge runtime request policy", () => {
  it("blocks public reaggregate maintenance dispatch", () => {
    expect(isMaintenanceRequestAllowed("reaggregate-vibes", false)).toBe(false);
  });

  it("allows internal reaggregate maintenance dispatch", () => {
    expect(isMaintenanceRequestAllowed("reaggregate-vibes", true)).toBe(true);
  });

  it("does not block normal public scraper source dispatch", () => {
    expect(isMaintenanceRequestAllowed(undefined, false)).toBe(true);
  });
});
