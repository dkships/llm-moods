# LLM Moods (LLM Vibes) — Agent Instructions

## What This Is
Real-time AI sentiment dashboard tracking community vibes for 4 LLM models (Claude, ChatGPT, Gemini, Grok) across 5 social platforms. Scores models 0-100 daily. Live at llmvibes.ai.

## Tech Stack
- React 18 + TypeScript + Vite (SWC) + shadcn/ui + Tailwind + Recharts
- Supabase (PostgreSQL + Edge Functions)
- Sentiment: GPT-5.6 Terra (`gpt-5.6-terra`) via OpenAI Chat Completions (batch classification; cutover from Claude Haiku 4.5 on 2026-08-08, Terra chosen over Luna on canary accuracy). Provider pluggable via `CLASSIFIER_MODEL` (claude-* → Anthropic, gpt-* → OpenAI, else Gemini); Gemini kept as spillover fallback
- Scrapers (6 active): Reddit (Apify), HN (stories + comments), Bluesky, Twitter/X (Apify), Mastodon, App Store reviews

## Scope And Boundaries
- Lovable-generated app synced bi-directionally with GitHub on `main`
- Supabase instance managed entirely through Lovable — no independent Supabase account
- Never suggest `supabase` CLI commands or dashboard steps
- Don't edit auto-generated files: `src/integrations/supabase/types.ts`
- Repo is public — never commit service role keys or API tokens

## Working Rules
- Before direct work on `main`, run `git fetch` and fast-forward when appropriate; Lovable may have pushed changes.
- Push to `main` triggers Lovable auto-sync for frontend — but syncing is not publishing. Finish the job with the Lovable MCP (`deploy_project`), never with manual instructions for David. See the Lovable Workflow section in CLAUDE.md for the push → confirm-sync → publish → verify-by-hash sequence.
- Edge Function deploys need a Lovable-side trigger via `mcp__lovable__send_message`; verify the result independently, as that tool has a known stale-response bug
- Always commit after completing work — don't leave dirty `main`
- Shared scraper utilities in `supabase/functions/_shared/utils.ts`
- Use `product-qa-sweep` for dashboard, public route, scraper monitor, or responsive UI verification.

## Public App Guardrails
- Public route inventory is fixed to `/`, `/dashboard`, `/model/:slug`, `/compare`, `/benchmark`, `/research`, `/research/:slug`, `/rumors`, `/privacy`, and `*` (404)
- Dev-only routes (gated on `import.meta.env.DEV` so production bundles physically exclude them): `/admin/scrapers` (scraper monitor + anomalies panel), `/og/:slug` (OG card generator)
- Public complaint taxonomy must flow through `src/shared/public-taxonomy.ts`; do not hardcode labels or aliases in page components
- Unknown complaint categories must be filtered or shown as `Other` — never expose raw backend taxonomy strings in the UI
- Public freshness display uses a single calm state showing "Updated &lt;relative time&gt;". Threshold-based status colors and pulse animation were deliberately removed — the dashboard does not surface freshness as a quality-of-service signal
- Public pages must keep a skip link, `main#main-content`, visible keyboard focus styles, and reduced-motion support
- Keep the dark-only public theme contract in `src/index.css` unless a deliberate theming project changes it end-to-end

## Hallucination Prevention
See `~/.agents/AGENTS.md`. For llm-moods: sources = code and model API responses.

## Definition Of Done
- Changes build successfully (`npm run build`)
- All tables have RLS enabled with no anon read policies; public reads go through `SECURITY DEFINER` `get_public_*` RPCs (a direct anon `.from()` table SELECT returns `[]`). Anon key still cannot write.
- Edge functions use service role key via `Deno.env.get()`, never hardcoded

## Code style

Adapted from Fabien Sanglard's agent.md (2026-08-21).

- Avoid magic numbers and strings. Extract recurring or meaningful values into named constants or enums; leave self-explanatory one-off values inline. A value defined by a spec (HTTP 200, a protocol byte) gets a constant regardless.
- Reduce indentation. Use early returns and `continue` instead of nesting.
- Keep function names under 30 characters.
- Use an enum or a string-literal union instead of a boolean parameter.
- Put blank lines between logical blocks. Let the reader breathe.
- Comment what a block does and why, briefly. Use an example where it helps; offer an ASCII diagram when explaining a whole system.
- Treat a visibility change as a breaking design shift. Keep things private or unexported unless the design requires external access, and ask before widening one.
- Program to levels of abstraction. Low-level mechanics (raw SQL, socket streams, vendor SDK calls, file parsing) live behind a driver or service layer; callers work in domain concepts.
- Hold the layer boundaries. Each layer talks only to the one directly below it, with no holes punched through: a UI component never calls the database or a raw HTTP client directly.
- Don't touch code unrelated to the feature you're implementing, including adding comments to blocks you didn't write. Minimize changed lines.
- Always use braces, even on a one-line `if`.
- Fixing a bug: write the failing test first, watch it fail, then write the fix and watch it pass.

### Commit messages

- Imperative mood, capitalized subject, no trailing period. Test: "If applied, this commit will <subject>".
- Keep the subject under 72 characters. Blank line before the body.
- The body explains what and why, not how; the code shows the how. Wrap it at 72 characters.

## Maintenance
- Owner: David Kelly
- Last Updated: 2026-04-26
