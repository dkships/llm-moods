import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stripMotionProps = ({
  animate,
  custom,
  exit,
  initial,
  transition,
  variants,
  viewport,
  whileHover,
  whileInView,
  ...rest
}: Record<string, unknown>) => rest;

vi.mock("framer-motion", async () => {
  const ReactModule = await import("react");

  const createMotionComponent = (tag: keyof React.JSX.IntrinsicElements) =>
    ReactModule.forwardRef<HTMLElement, Record<string, unknown>>(({ children, ...props }, ref) =>
      ReactModule.createElement(tag, { ref, ...stripMotionProps(props) }, children as React.ReactNode),
    );

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    MotionConfig: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, { get: (_, tag: string) => createMotionComponent(tag as keyof React.JSX.IntrinsicElements) }),
    useReducedMotion: () => false,
  };
});

const mockUseModelsWithLatestVibes = vi.fn();
const mockUseRecentChatter = vi.fn();
const mockUsePrefetchModelDetail = vi.fn();
const mockUseModelDetail = vi.fn();
const mockUseVibesHistory = vi.fn();
const mockUseComplaintBreakdown = vi.fn();
const mockUseSourceBreakdown = vi.fn();
const mockUseModelPosts = vi.fn();

vi.mock("@/hooks/useVibesData", () => ({
  useModelsWithLatestVibes: () => mockUseModelsWithLatestVibes(),
  useRecentChatter: () => mockUseRecentChatter(),
  usePrefetchModelDetail: () => mockUsePrefetchModelDetail(),
  useModelDetail: () => mockUseModelDetail(),
  useVibesHistory: () => mockUseVibesHistory(),
  useComplaintBreakdown: () => mockUseComplaintBreakdown(),
  useSourceBreakdown: () => mockUseSourceBreakdown(),
  useModelPosts: () => mockUseModelPosts(),
}));

vi.mock("@/components/VibesChart", () => ({
  default: () => <div data-testid="vibes-chart">Chart</div>,
}));

vi.mock("@/components/Sparkline", () => ({
  default: () => <div data-testid="sparkline">Sparkline</div>,
}));

const mockModels = [
  {
    id: "chatgpt-id",
    name: "ChatGPT",
    slug: "chatgpt",
    accent_color: "#10b981",
    latestScore: 59,
    vibe: 59,
    trend: { direction: "up" as const, pts: 13 },
    sparkline: [
      { score: 52, isCarryForward: false },
      { score: 59, isCarryForward: false },
    ],
    topComplaint: "reasoning",
    totalPosts: 328,
    latestScoreTotalPosts: 42,
    recentPosts7d: 328,
    eligiblePosts: 31,
    lastUpdated: "2026-04-29T10:00:00.000Z",
    scoreComputedAt: "2026-04-29T11:30:00.000Z",
    latestPostPostedAt: "2026-04-29T09:00:00.000Z",
    latestPostIngestedAt: "2026-04-29T10:00:00.000Z",
    scorePeriodStart: "2026-04-29T07:00:00.000Z",
    scorePeriodEnd: "2026-04-30T07:00:00.000Z",
    scoreBasisStatus: "measured",
    measurementPeriodStart: "2026-04-29T07:00:00.000Z",
    carriedFromPeriodStart: null,
    isLatestCarryForward: false,
  },
  {
    id: "claude-id",
    name: "Claude",
    slug: "claude",
    accent_color: "#f59e0b",
    latestScore: 50,
    vibe: 50,
    trend: { direction: "down" as const, pts: 3 },
    sparkline: [
      { score: 53, isCarryForward: false },
      { score: 50, isCarryForward: false },
    ],
    topComplaint: "general_drop",
    totalPosts: 281,
    latestScoreTotalPosts: 38,
    recentPosts7d: 281,
    eligiblePosts: 24,
    lastUpdated: "2026-04-29T10:00:00.000Z",
    scoreComputedAt: "2026-04-29T11:30:00.000Z",
    latestPostPostedAt: "2026-04-29T09:00:00.000Z",
    latestPostIngestedAt: "2026-04-29T10:00:00.000Z",
    scorePeriodStart: "2026-04-29T07:00:00.000Z",
    scorePeriodEnd: "2026-04-30T07:00:00.000Z",
    scoreBasisStatus: "measured",
    measurementPeriodStart: "2026-04-29T07:00:00.000Z",
    carriedFromPeriodStart: null,
    isLatestCarryForward: false,
  },
];

const mockPost = {
  id: "post-1",
  complaint_category: "reasoning",
  content: "OpenAI API errors made ChatGPT unreliable again.",
  created_at: "2026-04-29T10:00:00.000Z",
  model_id: "chatgpt-id",
  original_language: null,
  posted_at: "2026-04-29T09:00:00.000Z",
  praise_category: null,
  sentiment: "negative",
  source: "reddit",
  source_url: "https://example.com/post-1",
  title: "OpenAI API errors are back",
  translated_content: null,
};

beforeEach(() => {
  mockUsePrefetchModelDetail.mockReturnValue(vi.fn());
  mockUseModelsWithLatestVibes.mockReturnValue({
    data: mockModels,
    isLoading: false,
    isError: false,
  });
  mockUseRecentChatter.mockReturnValue({
    data: { pages: [[{ ...mockPost, models: { name: "ChatGPT", accent_color: "#10b981", slug: "chatgpt" } }]] },
    isLoading: false,
    isError: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  });
  mockUseModelDetail.mockReturnValue({
    data: { id: "chatgpt-id", name: "ChatGPT", slug: "chatgpt", accent_color: "#10b981" },
    isLoading: false,
  });
  mockUseVibesHistory.mockReturnValue({
    data: [{ period_start: "2026-04-18T00:00:00.000Z", score: 59 }],
    isLoading: false,
    isError: false,
  });
  mockUseComplaintBreakdown.mockReturnValue({
    data: [{ category: "reasoning", count: 10, pct: 100 }],
    isLoading: false,
    isError: false,
  });
  mockUseSourceBreakdown.mockReturnValue({
    data: [{ source: "reddit", count: 10, pct: 100 }],
    isLoading: false,
    isError: false,
  });
  mockUseModelPosts.mockReturnValue({
    data: [mockPost],
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderAt(route: string) {
  window.history.pushState({}, "", route);
  const { default: App } = await import("@/App");
  render(<App />);
}

describe("public app routes", () => {
  it("renders the landing page smoke path", async () => {
    await renderAt("/");

    expect(await screen.findByRole("heading", { name: /is your ai having a bad day/i })).toBeInTheDocument();
    expect(screen.getByText(/skip to main content/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /chatgpt mixed signals 59/i })).toBeInTheDocument();
  });

  it("renders the dashboard route with freshness status", async () => {
    await renderAt("/dashboard");

    expect(await screen.findByRole("heading", { name: /current vibes/i })).toBeInTheDocument();
    const freshnessStatus = screen.getAllByRole("status").find((element) =>
      /^updated\b/i.test(element.textContent || ""),
    );
    expect(freshnessStatus).toBeDefined();
    expect(screen.getByRole("heading", { name: /recent community chatter/i })).toBeInTheDocument();
  });

  it("renders the model detail route and chart controls", async () => {
    await renderAt("/model/chatgpt");

    expect(await screen.findByRole("heading", { name: /^chatgpt$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: /recent posts about chatgpt/i })).toBeInTheDocument();
  });

  it("renders model detail with separate post freshness and score diagnostics", async () => {
    await renderAt("/model/chatgpt");

    expect(await screen.findByText(/updated\b/i)).toBeInTheDocument();
    expect(screen.getByText(/^score recalculated\b/i)).toBeInTheDocument();
    expect(screen.getByText(/^latest classified post\b/i)).toBeInTheDocument();
  });

  it("labels negative surface distribution with the loaded 7-day window", async () => {
    await renderAt("/model/chatgpt");

    expect(await screen.findByRole("heading", { name: /negative posts by surface/i })).toBeInTheDocument();
    expect(screen.getByText(/loaded 7-day recent-post window/i)).toBeInTheDocument();
  });

  it("renders an empty recent-post state on the all filter", async () => {
    mockUseModelPosts.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    await renderAt("/model/chatgpt");

    expect(await screen.findByText(/no posts in the last 7 days/i)).toBeInTheDocument();
  });

  it("renders the not found route", async () => {
    await renderAt("/does-not-exist");

    expect(await screen.findByText(/this page doesn't exist/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to home/i })).toBeInTheDocument();
  });
});
