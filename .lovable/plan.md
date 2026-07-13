# Hero Overall Vibe Gauge

## Problem
On screens ≥1024px, the right ~50% of the hero is empty — the ambient glow is too faint to read as intentional, so it looks unfinished. Mobile/tablet stack the content and don't have this issue.

## Solution
Fill the right column with a single, calm **live "overall vibe" gauge**: a circular dial showing today's average score across all four tracked models (Claude, ChatGPT, Gemini, Grok), colored by sentiment and labeled with the weather metaphor (Good Vibes / Mixed Signals / Bad Vibes). This is data-authentic (matches the "100% automated" ethos), instantly answers the "bad day?" question above the fold, and reinforces the weather-app-for-AI concept — all with one restrained element.

```text
┌───────────────────────────────────────────────┐
│  Is your AI having                    ╭─────╮   │
│  a bad day?                          (  44  )   │  ← arc colored by sentiment
│                                       ╰─────╯   │
│  A daily read on community...      MIXED SIGNALS│
│                                    avg · 4 models│
│  [ Check the Vibes → ]                          │
│  INDEPENDENT · 100% AUTOMATED · OPEN SOURCE     │
└───────────────────────────────────────────────┘
```

## Behavior
- **Score**: rounded average of each model's `latestScore` from the existing `useModelsWithLatestVibes()` hook (already fetched on this page — no new data call).
- **Color + label**: derived via existing `getVibeStatus(avg)` → uses `SENTIMENT_HSL` (green/amber/red). No hardcoded colors.
- **Sub-labels**: the vibe label (e.g. "Mixed Signals") plus a quiet meta line like `AVG · 4 MODELS` in `text-mono-cap text-text-tertiary`.
- **States**: loading → subtle skeleton ring; error/empty → gauge simply doesn't render (hero falls back to current whitespace, no error text in the hero).

## Layout / responsive
- Hero `<section>` becomes a two-column grid at `lg:` (`lg:grid-cols-[minmax(0,1fr)_auto]`), text left, gauge right and vertically centered.
- Below `lg` the gauge is hidden (`hidden lg:flex`) so mobile/tablet keep the current clean stacked layout that already works. The live model score cards below already deliver the payoff on small screens.
- Keep the existing max-width on the text column so line breaks in the headline are unchanged.

## Visual details (restraint contract)
- Rendered as a lightweight inline **SVG arc** (two stacked circles: a faint track + a sentiment-colored progress arc), diameter ~260–300px. No Recharts dependency.
- Big centered number uses the `score-xl` type rung; label uses `section`/`mono-cap` rungs — no hand-rolled font sizes.
- One gentle fade-in on mount and a single ease on the arc draw; **respects `prefers-reduced-motion`** (arc renders at final value, no animation). No looping/pulsing.
- The faint existing radial glow stays but is nudged to sit behind the gauge so the two read as one intentional focal point.

## Technical
- New component `src/components/HeroVibeGauge.tsx` (presentational; receives `score`, `isLoading` as props).
- Edit `src/pages/Index.tsx`: compute `avgScore` from `models`, wrap hero content in the two-column grid, render `<HeroVibeGauge>` in the right column.
- Colors strictly from `getVibeStatus`/`SENTIMENT_HSL`; text tokens per the type ladder. No new dependencies, no backend changes.

## Verification
- `npm run build` passes.
- Playwright screenshots at 1920 / 1440 / 1024 (gauge visible, balanced) and 768 / 375 (gauge hidden, layout unchanged).
- Confirm gauge number equals the rounded average of the four visible card scores, and its color matches the sentiment band.
