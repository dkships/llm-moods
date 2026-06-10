# Visual Polish Pass — LLM Vibes

A note up front: I found no evidence of a "Fable 5" model from Anthropic, and adding/tracking new models is explicitly out of scope for this project (only Claude, ChatGPT, Gemini, Grok). This plan is a **pure visual polish pass** — no new model, no data/classifier changes.

## Goal

Elevate the overall look and feel across every public surface while staying inside the project's documented design contract: 8-rung type ladder, sentiment-only color usage, accent hue reserved for specific elements, restraint-first motion, dark-only theme. This is refinement that makes the existing system sharper and more premium — not a redesign that fights the guardrails.

## Approach

Two layers of change, both within the system:

1. **Token-level depth** (in `src/index.css` / `tailwind.config.ts`): introduce a small, semantic set of elevation/gradient tokens so surfaces feel more crafted (soft layered shadows, a subtle card top-highlight, refined border opacity). These are additive tokens — existing tokens keep their meaning, so nothing breaks downstream.
2. **Surface-level refinement** (per page/component): tighten spacing rhythm, hierarchy, and a single calm interaction per element using the new tokens. No type-ladder violations, no new accent-hue usage beyond what's already reserved.

## Scope by surface

### Global primitives
- `Surface.tsx`: add an optional, opt-in elevation via a new shadow token so cards read with gentle depth instead of flat fills; keep the single calm `hover:border-border/80` baseline and add a barely-there shadow lift on interactive cards only.
- `NavBar.tsx`: refine the sticky bar — slightly stronger blur/contrast separation on scroll feel, tighter wordmark alignment, consistent focus rings (already good).
- `Footer.tsx`: balance spacing and divider weight to match the refined surfaces.

### Landing (`/`)
- Hero: refine the radial glow (softer, better positioned), tighten headline-to-subhead-to-CTA rhythm, and give the CTA a slightly more deliberate hover.
- Model preview grid + "How it works": consistent vertical rhythm and section dividers using refined border tokens.

### Dashboard (`/dashboard`)
- Page header, model card grid, Trending Complaints, and chatter feed: unify section spacing, refine `ModelCard` (sentiment cue bar, sparkline framing, meta line) for depth and clearer hierarchy, polish the "Load more" affordance.

### Model detail (`/model/:slug`)
- Header/score block, chart container, BarList breakdowns, StatusCard, surface filter chips, and recent posts: consistent card elevation, tighter two-column rhythm, calmer chart container framing.

### Research (`/research`, `/research/:slug`)
- Light touch only — the editorial accent register is deliberate. Align card chrome and spacing with the refreshed primitives without flattening the article voice.

## Guardrails honored
- No changes to the 8-rung type ladder (no `text-[Npx]` / ad-hoc sizes).
- Sentiment colors stay sourced from `SENTIMENT_HSL`; accent hue stays reserved for its existing uses.
- One page-level fade per render; no per-section staggers.
- Dark-only theme contract preserved; all new colors defined as HSL semantic tokens.
- No backend, data, classifier, or routing changes.

## Technical notes
- New tokens added to `:root` in `src/index.css` and mirrored in `tailwind.config.ts` (e.g. `--shadow-elevated`, `--shadow-card`, optional `--gradient-surface` top highlight). Used via semantic classes only.
- Changes confined to `src/pages/*`, `src/components/*` (excluding `src/components/ui/` shadcn-managed), `src/index.css`, `tailwind.config.ts`.
- Verify with a build and a visual sweep across all routes at desktop + mobile widths before finishing.

## Out of scope
- Any "Fable 5" / new model work.
- Token meaning changes that would alter sentiment or accent semantics.
- Bolder structural/layout redesigns of any surface.
