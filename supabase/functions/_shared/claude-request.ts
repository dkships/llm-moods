// Per-model request rules for the two Claude call sites (sentiment classifier
// and rumor extraction). Both send one record_* tool and read its input back,
// but Claude generations disagree on what that request may contain:
//
//   model                         forced tool_choice   effort   thinking default
//   claude-haiku-4-5 (and older)  ok                   400      off
//   claude-haiku-5-5              ok, skips thinking   ok       adaptive, on
//   claude-sonnet-5-5 / opus-5-5  400                  ok       adaptive, on
//   claude-fable-5-1 / mythos-5-1 400                  ok       adaptive, on
//
// Every model on this list rejects non-default temperature/top_p/top_k and
// assistant prefill, so neither is ever sent.

const FORCED_TOOL_REJECTED = /^claude-(opus-5-5|sonnet-5-5|fable-5-1|mythos-5-1)/;
const EFFORT_SUPPORTED = /^claude-(haiku-5|sonnet-5|opus-5|fable|mythos|opus-4-[5-9]|sonnet-4-6)/;

// Thinking shares max_tokens with the tool call, so a thinking model needs
// headroom above the answer's own budget or the call gets cut off mid-array.
const THINKING_HEADROOM_TOKENS = 8000;

export type ClaudeEffort = "low" | "medium" | "high";
export type ToolChoiceMode = "forced" | "auto";

export function acceptsForcedTool(model: string): boolean {
  return !FORCED_TOOL_REJECTED.test(model.toLowerCase());
}

export function supportsEffort(model: string): boolean {
  return EFFORT_SUPPORTED.test(model.toLowerCase());
}

// Default per model: a thinking model gets auto, because a forced call skips
// thinking. On the 2026-10-07 eval Haiku 5.5 auto beat forced on rumor claim
// types (22/25 vs 17/24 against Opus 5.5), and the classifier only came near
// gpt-6-sol at effort high, which needs auto to matter. A model without
// thinking (Haiku 4.5) keeps the forced call it was validated with.
export function defaultToolChoice(model: string): ToolChoiceMode {
  return supportsEffort(model) ? "auto" : "forced";
}

// A model that rejects forcing always gets auto, whatever the caller prefers.
export function claudeToolChoice(model: string, toolName: string, mode: ToolChoiceMode) {
  if (mode === "forced" && acceptsForcedTool(model)) {
    return { type: "tool", name: toolName };
  }
  return { type: "auto" };
}

// Fields to spread into the request body: output_config.effort where the model
// has it (Haiku 4.5 returns a 400 on the field), plus the max_tokens cap with
// thinking headroom when the model can think before the tool call.
export function claudeBudgetFields(
  model: string,
  answerTokens: number,
  effort: ClaudeEffort,
  toolChoice: { type: string },
): Record<string, unknown> {
  if (!supportsEffort(model)) {
    return { max_tokens: answerTokens };
  }
  // A forced call skips thinking, so the answer budget alone is enough.
  const thinks = toolChoice.type === "auto";
  return {
    max_tokens: thinks ? answerTokens + THINKING_HEADROOM_TOKENS : answerTokens,
    output_config: { effort },
  };
}

export type ToolInputRead =
  | { input: Record<string, unknown> }
  | { failure: string; kind: "refusal" | "truncated" | "no_tool_call" };

// Read the tool call by block type, never by position: a thinking model's
// response opens with thinking blocks. A refusal (HTTP 200, stop_reason
// "refusal") is checked first; there is no server-side fallback on Haiku 5.5.
export function readToolInput(data: unknown, toolName: string): ToolInputRead {
  const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  const stopReason = typeof record.stop_reason === "string" ? record.stop_reason : null;

  if (stopReason === "refusal") {
    const details = record.stop_details as { category?: unknown } | undefined;
    const category = typeof details?.category === "string" ? details.category : "unspecified";
    return { failure: `refusal (${category})`, kind: "refusal" };
  }

  const content = Array.isArray(record.content) ? record.content : [];
  const toolUse = content.find((block) => {
    const b = block as { type?: unknown; name?: unknown; input?: unknown };
    return b?.type === "tool_use" && b.name === toolName && typeof b.input === "object" && b.input !== null;
  }) as { input: Record<string, unknown> } | undefined;

  if (toolUse) {
    return { input: toolUse.input };
  }
  if (stopReason === "max_tokens") {
    return { failure: `max_tokens before a ${toolName} call`, kind: "truncated" };
  }
  return { failure: `response had no ${toolName} tool_use block`, kind: "no_tool_call" };
}
