import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDailyChartData, useStatusIncidentMarkers } from "@/lib/use-chart-data";

const row = (isoDay: string, score: number) => ({
  period_start: `${isoDay}T07:00:00Z`, // Pacific-midnight bucket as stored by the aggregator
  score,
  total_posts: 20,
  eligible_posts: 15,
  score_basis_status: "full",
  queued_posts: 0,
  failed_posts: 0,
  classification_coverage: 1,
});

describe("useDailyChartData live-anchor grid", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("anchors on the Pacific day during the evening UTC/Pacific split", () => {
    // 2026-06-13T02:00:00Z is 2026-06-12 19:00 PDT — UTC date is already "tomorrow".
    vi.setSystemTime(new Date("2026-06-13T02:00:00.000Z"));
    const history = [
      row("2026-06-06", 50),
      row("2026-06-07", 51),
      row("2026-06-08", 52),
      row("2026-06-09", 53),
      row("2026-06-10", 54),
      row("2026-06-11", 55),
      row("2026-06-12", 56),
    ];

    const { result } = renderHook(() => useDailyChartData(history, 7));
    const points = result.current.chartData;

    expect(points).toHaveLength(7);
    // Rightmost slot is the current Pacific day, labeled Today, with its data —
    // not a phantom empty "Jun 13".
    expect(points[6].day).toBe("Today");
    expect(points[6].score).toBe(56);
    // Leftmost day is not silently dropped.
    expect(points[0].score).toBe(50);
  });

  it("keeps the same grid before and after the UTC midnight rollover", () => {
    const history = [row("2026-06-11", 55), row("2026-06-12", 56)];

    vi.setSystemTime(new Date("2026-06-12T23:00:00.000Z")); // 4pm PDT
    const before = renderHook(() => useDailyChartData(history, 7)).result.current.chartData;

    vi.setSystemTime(new Date("2026-06-13T01:00:00.000Z")); // 6pm PDT, past UTC midnight
    const after = renderHook(() => useDailyChartData(history, 7)).result.current.chartData;

    expect(after.map((p) => p.day)).toEqual(before.map((p) => p.day));
    expect(after[6].day).toBe("Today");
  });

  it("still honors an explicit anchorDate for pinned research windows", () => {
    vi.setSystemTime(new Date("2026-06-13T02:00:00.000Z"));
    const history = [row("2026-05-13", 40), row("2026-05-14", 41)];

    const { result } = renderHook(() =>
      useDailyChartData(history, 2, new Date(Date.UTC(2026, 4, 14))),
    );
    const points = result.current.chartData;

    expect(points).toHaveLength(2);
    expect(points[0].score).toBe(40);
    expect(points[1].score).toBe(41);
    expect(points[1].day).not.toBe("Today");
  });
});

describe("useStatusIncidentMarkers", () => {
  const dateLabels = { "2026-09-02": "Sep 2", "2026-09-03": "Sep 3", "2026-09-04": "Sep 4" };
  const incident = (title: string, severity: string, updatedAt = "2026-09-03T18:00:00Z") => ({
    id: `${title}-${updatedAt}`,
    title,
    updatedAt,
    summary: null,
    url: null,
    severity: severity as "critical" | "major" | "minor" | "maintenance" | "unknown",
  });

  it("collapses one outage filed per component into a single marker with a surface count", () => {
    const events = [
      incident("[Grok (iOS)] Models outage", "major"),
      incident("[Grok (Web)] Models outage", "major"),
      incident("[API (us-east-1.api.x.ai)] Models outage", "critical"),
    ];
    const { result } = renderHook(() => useStatusIncidentMarkers(events, dateLabels));
    expect(result.current).toEqual([
      { startLabel: "Sep 3", color: expect.any(String), title: "Models outage · 3 surfaces", kind: "incident" },
    ]);
  });

  it("skips minor and maintenance events and days outside the window", () => {
    const events = [
      incident("[Claude] Elevated errors", "minor"),
      incident("Scheduled maintenance", "maintenance"),
      incident("Outage", "major", "2026-08-01T12:00:00Z"),
    ];
    const { result } = renderHook(() => useStatusIncidentMarkers(events, dateLabels));
    expect(result.current).toEqual([]);
  });
});
