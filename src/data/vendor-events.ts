export type Vendor = "anthropic" | "openai" | "google" | "xai";
export type ModelSlug = "claude" | "chatgpt" | "gemini" | "grok";
export type VendorEventType =
  | "postmortem"
  | "model_launch"
  | "known_regression"
  | "pricing_change"
  | "outage"
  | "infrastructure_change";

export interface VendorEvent {
  id: string;
  vendor: Vendor;
  /** If omitted, event applies to every model from this vendor. */
  modelSlug?: ModelSlug;
  /** ISO date YYYY-MM-DD. */
  eventDate: string;
  /** ISO date YYYY-MM-DD for ranged events; omit for single-day. */
  eventEndDate?: string;
  eventType: VendorEventType;
  title: string;
  url?: string;
  notes?: string;
}

const VENDOR_BY_MODEL: Record<ModelSlug, Vendor> = {
  claude: "anthropic",
  chatgpt: "openai",
  gemini: "google",
  grok: "xai",
};

export const VENDOR_EVENTS: VendorEvent[] = [
  {
    id: "anthropic-2026-bug1-reasoning-effort",
    vendor: "anthropic",
    modelSlug: "claude",
    eventDate: "2026-03-04",
    eventEndDate: "2026-04-07",
    eventType: "known_regression",
    title: "Reasoning effort default lowered (Bug 1)",
    url: "https://www.anthropic.com/engineering/april-23-postmortem",
    notes: "Default reasoning effort changed high → medium for Claude Code. Users reported the model felt 'less intelligent.'",
  },
  {
    id: "anthropic-2026-bug2-thinking-cache",
    vendor: "anthropic",
    modelSlug: "claude",
    eventDate: "2026-03-26",
    eventEndDate: "2026-04-10",
    eventType: "known_regression",
    title: "Thinking-cache bug (Bug 2)",
    url: "https://www.anthropic.com/engineering/april-23-postmortem",
    notes: "Cache cleared thinking every turn instead of once per idle session. Forgetful, repetitive, usage limits drained faster.",
  },
  {
    id: "anthropic-2026-bug3-verbosity-prompt",
    vendor: "anthropic",
    modelSlug: "claude",
    eventDate: "2026-04-16",
    eventEndDate: "2026-04-20",
    eventType: "known_regression",
    title: "≤25-word verbosity prompt (Bug 3)",
    url: "https://www.anthropic.com/engineering/april-23-postmortem",
    notes: "System prompt added a verbosity cap on Opus 4.7. ~3% drop in coding quality evals.",
  },
  {
    id: "anthropic-2026-04-23-postmortem",
    vendor: "anthropic",
    modelSlug: "claude",
    eventDate: "2026-04-23",
    eventType: "postmortem",
    title: "Anthropic publishes Claude Code quality postmortem",
    url: "https://www.anthropic.com/engineering/april-23-postmortem",
  },
  {
    id: "anthropic-opus-4-7-launch",
    vendor: "anthropic",
    modelSlug: "claude",
    eventDate: "2026-04-16",
    eventType: "model_launch",
    title: "Opus 4.7 launch",
    notes: "Date inferred from public chatter (`Opus 4.7 Dropped` posts on April 17).",
  },
];

export function getEventsForModel(slug: string | undefined): VendorEvent[] {
  if (!slug) return [];
  const normalizedSlug = slug as ModelSlug;
  const vendor = VENDOR_BY_MODEL[normalizedSlug];
  return VENDOR_EVENTS.filter((event) => {
    if (event.modelSlug) return event.modelSlug === normalizedSlug;
    return event.vendor === vendor;
  });
}

const EVENT_TYPE_COLORS: Record<VendorEventType, string> = {
  postmortem: "hsl(220 80% 65%)",
  model_launch: "hsl(200 70% 60%)",
  known_regression: "hsl(0 75% 60%)",
  pricing_change: "hsl(40 85% 60%)",
  outage: "hsl(0 60% 50%)",
  infrastructure_change: "hsl(260 60% 65%)",
};

export function getEventColor(type: VendorEventType): string {
  return EVENT_TYPE_COLORS[type];
}
