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

  it("keeps facing labels by flipping the older one", () => {
    const kept = pickEventLabels(markers, layout);
    expect(kept.get(2)).toEqual({ side: "left", row: 0 });
    expect(kept.get(1)).toEqual({ side: "left", row: 0 });
    expect(kept.get(0)).toEqual({ side: "right", row: 0 });
  });

  it("keeps both 30d launch labels a week apart", () => {
    // Claude's 30d chart on Oct 5: Opus 5.5 (Sep 22, day 16) runs right and
    // Sonnet 5.5 (Sep 28, day 22) flips left, so they met in the middle and
    // Opus 5.5 was dropped.
    const thirtyDay = { dayCount: 30, plotWidth: 656, flipAfterDay: 20 };
    const kept = pickEventLabels(
      [
        { index: 0, day: 16, text: "Claude Opus 5.5" },
        { index: 1, day: 22, text: "Claude Sonnet 5.5" },
      ],
      thirtyDay,
    );
    expect(kept.size).toBe(2);
  });

  it("drops to a second row when both sides are taken", () => {
    const tight = { dayCount: 30, plotWidth: 656, flipAfterDay: 20 };
    const kept = pickEventLabels(
      [
        { index: 0, day: 10, text: "Claude Opus 5.5" },
        { index: 1, day: 12, text: "Claude Sonnet 5.5" },
        { index: 2, day: 14, text: "Claude Haiku 5" },
      ],
      tight,
    );
    expect(kept.size).toBe(3);
    expect([...kept.values()].some((p) => p.row === 1)).toBe(true);
  });

  it("puts a second-row label on the side clear of the top row", () => {
    // A 556px plot: neither side of Opus 5.5 clears Sonnet 5.5 on the top
    // row, and right-of-line on row two would sit under the Sonnet label.
    const narrow = { dayCount: 30, plotWidth: 556, flipAfterDay: 20 };
    const kept = pickEventLabels(
      [
        { index: 0, day: 16, text: "Claude Opus 5.5" },
        { index: 1, day: 22, text: "Claude Sonnet 5.5" },
      ],
      narrow,
    );
    expect(kept.get(1)).toEqual({ side: "left", row: 0 });
    expect(kept.get(0)).toEqual({ side: "left", row: 1 });
  });

  it("never flips a label out of the plot", () => {
    const kept = pickEventLabels(
      [
        { index: 0, day: 1, text: "Claude Opus 5.5" },
        { index: 1, day: 3, text: "Claude Sonnet 5.5" },
      ],
      { dayCount: 30, plotWidth: 656, flipAfterDay: 20 },
    );
    expect(kept.get(0)?.side).toBe("right");
  });

  it("keeps every label on the top row when there is room", () => {
    const kept = pickEventLabels(markers, { ...layout, plotWidth: 2400 });
    expect([...kept.keys()].sort()).toEqual([0, 1, 2]);
    expect([...kept.values()].every((p) => p.row === 0)).toBe(true);
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
