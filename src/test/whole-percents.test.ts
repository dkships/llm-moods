import { describe, expect, it } from "vitest";
import { getModelAccent, toWholePercents } from "@/lib/vibes";
import { computeYTicks } from "@/lib/chart-scale";

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

describe("toWholePercents", () => {
  it("sums to 100 where Math.round would give 101", () => {
    expect(toWholePercents([7, 1])).toEqual([88, 12]);
  });

  it("sums to 100 where Math.round would give 99", () => {
    const percents = toWholePercents([1, 1, 1]);
    expect(percents).toEqual([34, 33, 33]);
    expect(sum(percents)).toBe(100);
  });

  it("keeps exact shares untouched", () => {
    expect(toWholePercents([3, 1])).toEqual([75, 25]);
  });

  it("returns zeros for an empty total", () => {
    expect(toWholePercents([0, 0])).toEqual([0, 0]);
    expect(toWholePercents([])).toEqual([]);
  });
});

describe("getModelAccent", () => {
  it("uses the model's brand color when set", () => {
    expect(getModelAccent({ accent_color: "#d97757" })).toBe("#d97757");
  });

  it("falls back to a neutral color when missing", () => {
    expect(getModelAccent(undefined)).toBe(getModelAccent({ accent_color: null }));
    expect(getModelAccent({ accent_color: "" })).toBe(getModelAccent(null));
  });
});

describe("computeYTicks", () => {
  it("steps by 10 inside a narrow domain", () => {
    expect(computeYTicks([25, 75])).toEqual([30, 40, 50, 60, 70]);
  });

  it("steps by 25 inside a wide domain", () => {
    expect(computeYTicks([10, 95])).toEqual([25, 50, 75]);
  });
});
