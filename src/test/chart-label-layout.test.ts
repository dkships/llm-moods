import { describe, expect, it } from "vitest";
import { pickEventLabels, pickMidlineSpot } from "@/lib/chart-label-layout";

describe("pickEventLabels", () => {
  // The Opus 5.5 article chart: Jul 13 – Sep 26 (76 days). Fable 5.1 (day 50)
  // sits left of the flip point so its label runs right; Opus 5.5 (day 71)
  // flips left. The two labels used to be drawn on top of each other.
  const layout = { dayCount: 76, plotWidth: 640, flipAfterDay: 76 * (2 / 3) };
  const markers = [
    { index: 0, day: 11, text: "Claude Opus 5" },
    { index: 1, day: 50, text: "Claude Fable 5.1" },
    { index: 2, day: 71, text: "Claude Opus 5.5" },
  ];

  it("drops a label that would collide with a facing label", () => {
    const kept = pickEventLabels(markers, layout);
    expect(kept.has(1) && kept.has(2)).toBe(false);
  });

  it("keeps the most recent label when two collide", () => {
    const kept = pickEventLabels(markers, layout);
    expect(kept.has(2)).toBe(true);
    expect(kept.has(0)).toBe(true);
  });

  it("keeps both labels when there is room", () => {
    const kept = pickEventLabels(markers, { ...layout, plotWidth: 2400 });
    expect([...kept].sort()).toEqual([0, 1, 2]);
  });
});

describe("pickMidlineSpot", () => {
  const plot = { yDomain: [30, 80] as [number, number], plotWidth: 640, plotHeight: 180 };

  it("slides right when the line hugs 50 at both ends", () => {
    // The Opus 5.5 article chart opens and closes near 50, which hid "balanced".
    const scores = [50, 50, 53, 49, 42, 46, 50, 51, 59, 58, ...Array(56).fill(65), 45, 30, 31, 55, 61, 67, 71, 69, 60, 50];
    const spot = pickMidlineSpot(scores, plot);
    expect(spot.startDay).toBeGreaterThan(3);
  });

  it("keeps the left edge above the line when that spot is clear", () => {
    const scores = [40, 42, 38, 41, 36, 35, 34, 33, 32, 31, ...Array(66).fill(60)];
    expect(pickMidlineSpot(scores, plot)).toEqual({ startDay: 0, side: "above" });
  });

  it("skips windows that would sit on an event marker", () => {
    const scores = [40, 42, 38, 41, 36, 35, 34, 33, 32, 31, ...Array(66).fill(60)];
    const spot = pickMidlineSpot(scores, { ...plot, markerDays: [3] });
    expect(spot.startDay).toBeGreaterThan(3);
  });

  it("drops below the line when only that side is clear", () => {
    // Hugs just above 50, so only the space under the line is free.
    const scores = [52, 53, 51, 52, 53, 52, 51, 52, 53, 52, ...Array(66).fill(40)];
    expect(pickMidlineSpot(scores, plot)).toEqual({ startDay: 0, side: "below" });
  });
});
