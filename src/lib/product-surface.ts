export type ProductSurface = "product_app" | "api" | "sdk" | "cli" | "unknown";

export interface DetectedSurface {
  surface: ProductSurface;
  label: string;
}

interface SurfacePattern {
  pattern: RegExp;
  surface: ProductSurface;
  label: string;
}

// Patterns are evaluated in order. Put the most specific (CLI / Codex / agent harnesses)
// before the broader product-app and API matchers so a post mentioning "Claude Code" doesn't
// fall through to a generic "claude.ai" match.
const SURFACE_PATTERNS: Record<string, SurfacePattern[]> = {
  claude: [
    { pattern: /\b(claude code|claudecode|cc cli)\b/i, surface: "cli", label: "Claude Code" },
    { pattern: /\b(claude\.ai|claude desktop|claude web|claude app|claude cowork)\b/i, surface: "product_app", label: "Claude.ai" },
    { pattern: /\b(anthropic api|messages api|claude api|console api)\b/i, surface: "api", label: "Anthropic API" },
    { pattern: /(@anthropic-ai|claude sdk|anthropic-sdk)/i, surface: "sdk", label: "SDK" },
  ],
  chatgpt: [
    { pattern: /\bcodex\b/i, surface: "cli", label: "Codex" },
    { pattern: /\b(chatgpt(\.com)?|gpt[- ]?app|chatgpt mobile|chatgpt desktop)\b/i, surface: "product_app", label: "ChatGPT" },
    { pattern: /\b(openai api|gpt api|chat completions|responses api)\b/i, surface: "api", label: "OpenAI API" },
    { pattern: /\b(openai sdk|openai[- ](node|python)|openai-js)\b/i, surface: "sdk", label: "SDK" },
  ],
  gemini: [
    { pattern: /\b(gemini cli|gemini sdk)\b/i, surface: "cli", label: "Gemini CLI" },
    { pattern: /\b(gemini\.google\.com|gemini app|gemini web|ai studio|google ai studio)\b/i, surface: "product_app", label: "Gemini app" },
    { pattern: /\b(gemini api|generativelanguage|vertex ai|google ai api)\b/i, surface: "api", label: "Gemini API" },
    { pattern: /(@google\/generative-ai|google-genai)/i, surface: "sdk", label: "SDK" },
  ],
  grok: [
    { pattern: /\b(grok in (x|twitter)|grok mobile|grok app|grok web)\b/i, surface: "product_app", label: "Grok app" },
    { pattern: /\b(xai api|grok api|x\.ai api)\b/i, surface: "api", label: "xAI API" },
  ],
};

/**
 * Detects which product surface a post is about based on lexical markers
 * in its title and content. Returns null if no pattern matches.
 *
 * The map is per-model_slug because surface taxonomies differ across vendors:
 * Claude has Claude Code (a CLI), ChatGPT has Codex, Gemini has AI Studio, etc.
 */
export function detectProductSurface(modelSlug: string, text: string): DetectedSurface | null {
  const patterns = SURFACE_PATTERNS[modelSlug];
  if (!patterns) return null;
  for (const p of patterns) {
    if (p.pattern.test(text)) {
      return { surface: p.surface, label: p.label };
    }
  }
  return null;
}

export function getKnownSurfacesForModel(modelSlug: string): DetectedSurface[] {
  const patterns = SURFACE_PATTERNS[modelSlug];
  if (!patterns) return [];
  const seen = new Set<string>();
  const out: DetectedSurface[] = [];
  for (const p of patterns) {
    const key = `${p.surface}:${p.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ surface: p.surface, label: p.label });
  }
  return out;
}
