// Rumor-extraction request: prompt, record_rumors tool, and the Anthropic
// request body. Zero Deno imports so the vitest suite and the local eval
// harness can build the exact request the edge function sends.
import { releasedSetPrompt } from "./rumor-canon.ts";
import {
  claudeBudgetFields,
  claudeToolChoice,
  defaultToolChoice,
  type ClaudeEffort,
  type ToolChoiceMode,
} from "./claude-request.ts";

export const RUMOR_DEFAULT_MODEL = "claude-haiku-5-5";

// Haiku 5.5 effort chosen by the 2026-10-07 eval (OPERATIONS-HISTORY.md): low
// with tool_choice auto matched the Opus 5.5 reference best, ahead of medium.
const RUMOR_EFFORT: ClaudeEffort = "low";

// The per-post `claims[]` output is larger than the sentiment classifier's
// one-result-per-post, so a 10-post batch needs this much room.
const EXTRACT_ANSWER_TOKENS = 8000;

// With tool_choice auto the user turn has to ask for the call.
const TOOL_INSTRUCTION =
  "\n\nRecord every post by calling the record_rumors tool exactly once. Do not answer in text.";

// Drives the model's `is_unreleased` judgment. Generated from the same catalog
// used by buildContribution + the frontend display filter so releases cannot
// drift between three manually maintained lists.
const RELEASED_SET = releasedSetPrompt();

export const RECORD_RUMORS_TOOL_NAME = "record_rumors";

const CLAIM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_rumor",
    "target_family",
    "is_unreleased",
    "claim_type",
    "claim_summary",
    "claim_mode",
    "evidence_kind",
    "confidence",
  ],
  properties: {
    is_rumor: { type: "boolean" },
    target_family: { type: "string", enum: ["claude", "chatgpt", "gemini", "grok", "unknown"] },
    version_label: { type: ["string", "null"] },
    codename: { type: ["string", "null"] },
    is_unreleased: { type: "boolean" },
    claim_type: { type: "string", enum: ["launch", "in_testing", "imminent", "delayed", "return", "other"] },
    claim_summary: { type: "string" },
    rumored_benefit: { type: ["string", "null"] },
    signals: { type: ["string", "null"] },
    eta_text: { type: ["string", "null"] },
    eta_date: { type: ["string", "null"] },
    claim_mode: {
      type: "string",
      enum: ["observed_signal", "reported_information", "inference", "speculation"],
    },
    evidence_kind: {
      type: "string",
      enum: ["artifact", "firsthand_access", "named_source", "official_hint", "prediction_market", "none"],
    },
    confidence: { type: "number" },
  },
};

const RECORD_RUMORS_TOOL = {
  name: RECORD_RUMORS_TOOL_NAME,
  description: "Record upcoming-model rumor claims extracted from the posts.",
  // strict tool use is intentionally OFF — the nullable-union fields above 400
  // under the structured-output JSON-Schema subset (same constraint as the
  // sentiment classifier). The tool call itself yields schema-shaped output.
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["posts"],
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "claims"],
          properties: {
            index: { type: "integer" },
            claims: { type: "array", items: CLAIM_SCHEMA },
          },
        },
      },
    },
  },
};

export const RUMOR_SYSTEM_PROMPT =
  "You extract rumor facts about UNRELEASED AI model versions from social posts.\n" +
  `RELEASED SET (already out — NOT rumors): ${RELEASED_SET}\n\n` +
  "For each numbered post, return an entry in `posts` with its `index` and a `claims` array.\n" +
  "A single post may contain MULTIPLE claims about different models/versions — emit one claim per (model, version).\n" +
  "If a post is not asserting information about an unreleased model, return its index with an empty claims array. " +
  "Merely naming or comparing a future model is not a rumor.\n\n" +
  "Per claim:\n" +
  "- is_rumor: true only if the post asserts information about an unreleased version/codename.\n" +
  "  Set false for sentiment, hopes, wish lists, jokes, hypotheticals, 'needs to/should/could' performance comparisons, " +
  "or guesses with no claimed source or observed evidence.\n" +
  "- Fable/Mythos public news or official availability pages are NOT rumors unless the post claims return, suspension, access change, or timing.\n" +
  "- target_family: claude (Anthropic) | chatgpt (OpenAI) | gemini (Google) | grok (xAI). " +
  "Use 'unknown' for ANY model from another maker (DeepSeek, Qwen, Llama, Mistral, Kimi, etc.) " +
  "or when unclear — never coerce a competitor's model into one of the four.\n" +
  "- version_label: copy the version token VERBATIM from the post (e.g. 'Sonnet 5', 'GPT-5.6'). Null if only a codename.\n" +
  "  For a numbered OpenAI generation followed by a codename (e.g. 'GPT-6 Sol'), use version_label 'GPT-6' and codename 'Sol'; never include the codename in both fields.\n" +
  "- codename: arena/internal codename if present (e.g. 'Fennec', 'Orionmist'). Null otherwise.\n" +
  "- is_unreleased: judge against the RELEASED SET above.\n" +
  "- claim_type: in_testing (EAP / enterprise partner testing / spotted in API / canary / arena), imminent (next week / any day), " +
  "delayed (pushed back / slipped / no longer this month), return (re-added / brought back / restored), " +
  "launch (a new version is coming), or other.\n" +
  "- claim_summary: one concise sentence on what's claimed.\n" +
  "- rumored_benefit: what it's rumored to improve, if stated (else null). Do not invent benchmark numbers.\n" +
  "- signals: the evidence cited — API slug, codename, app-code/string leak, benchmark leak, staff/exec hint, prediction-market odds (else null).\n" +
  "- claim_mode: observed_signal for a concrete app/API/config/selector artifact; reported_information when the author explicitly " +
  "claims non-public stage/timing from a source; inference when a concrete named signal supports a conclusion; speculation for " +
  "wishes, hypotheticals, jokes, unsupported predictions, or performance expectations.\n" +
  "- evidence_kind: artifact | firsthand_access | named_source | official_hint | prediction_market | none. " +
  "Use none for unsupported chatter and comparisons.\n" +
  "- eta_text: the raw timeframe phrase if stated or directly implied in the same bullet/sentence as this claim " +
  "(e.g. 'next week', '2nd week of July', 'mid-July', 'Q3'); NEVER invent one or copy another model's ETA — null if absent.\n" +
  "- eta_date: ISO date (YYYY-MM-DD) only for an exact calendar day or explicitly stated anchor date " +
  "(e.g. 'by July 1', 'week of July 30'). For vague windows like 'this week', 'next week', 'soon', " +
  "'mid-July', or 'Q3', set eta_date to null and preserve the phrase in eta_text.\n" +
  "- confidence: 0..1 that the post genuinely asserts non-public information, not the probability that the model will eventually exist.";

export interface RumorRequestOptions {
  toolChoice?: ToolChoiceMode;
  effort?: ClaudeEffort;
}

export function rumorRequestBody(
  model: string,
  userBlock: string,
  options: RumorRequestOptions = {},
): Record<string, unknown> {
  const toolChoice = claudeToolChoice(model, RECORD_RUMORS_TOOL_NAME, options.toolChoice ?? defaultToolChoice(model));
  return {
    model,
    ...claudeBudgetFields(model, EXTRACT_ANSWER_TOKENS, options.effort ?? RUMOR_EFFORT, toolChoice),
    // No temperature, top_p or prefill: current Claude models reject them.
    // Cached system block: ~20 batches per run share it within the 5-minute TTL
    // (Haiku 5.5's 512-token minimum is well below the prompt's size).
    system: [{ type: "text", text: RUMOR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userBlock + TOOL_INSTRUCTION }],
    tools: [RECORD_RUMORS_TOOL],
    tool_choice: toolChoice,
  };
}
