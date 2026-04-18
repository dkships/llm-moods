import { describe, expect, it } from "vitest";

import {
  getPublicComplaintLabel,
  normalizePublicComplaintCategory,
} from "@/shared/public-taxonomy";

describe("public complaint taxonomy", () => {
  it("normalizes supported aliases into public complaint categories", () => {
    expect(normalizePublicComplaintCategory("reliability")).toBe("api_reliability");
  });

  it("filters invalid complaint categories from the public UI contract", () => {
    expect(normalizePublicComplaintCategory("output_quality")).toBeNull();
    expect(normalizePublicComplaintCategory("privacy")).toBeNull();
  });

  it("returns stable human-readable labels for public complaint categories", () => {
    expect(getPublicComplaintLabel("pricing_value")).toBe("Pricing / value");
    expect(getPublicComplaintLabel("unknown_internal_category")).toBe("Other");
  });
});
