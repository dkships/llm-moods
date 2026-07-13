# Visual Polish Pass — Hero Simplification + Micro-Refinements

## Audit summary
Reviewed all routes at 1440px and 390px with fixed-viewport captures: `/`, `/dashboard`, `/model/:slug`, `/research`, `/rumors`, `/privacy`. The site is already cohesive and well-crafted — the type ladder, sentiment colors, and restraint contract are applied consistently. I'm deliberately **not** churning the pages that already work. One real defect and two small refinements are worth doing.

## 1. Hero simplification (primary fix)
**Problem:** The "all models" average gauge in the hero right column added visual weight without clear payoff and dominated the composition on smaller breakpoints. Iterations to make it responsive (compact mobile gauge, then centered mobile gauge, then background glow replacement) did not resolve the tension.

**Fix — remove the gauge and let the headline breathe:**
- Delete the `HeroVibeGauge` component and its usage on the landing page.
- Remove the `avgScore` calculation in `Index.tsx`.
- Restructure the hero as a single, centered column so the headline, tagline, CTA, and trust line read as one calm vertical stack.
- Keep the existing ambient radial glows for atmosphere.

**Net:** a cleaner, more confident hero that doesn't fight for attention with the live model score cards below.

## 2. Rumors card height alignment (small)
On desktop the two rumor cards render at different heights (the taller card sets the row, the shorter one leaves trailing space). Add `items-start` is already fine, but make the cards equal-height within a row (`h-full` on the card surface) so the row reads as a tidy pair rather than mismatched blocks. Purely presentational; no data change.

## 3. Hero glow alignment (small)
The ambient radial glows now frame the centered headline. Keep them soft and symmetrical so they read as atmospheric depth rather than a stray blob.

## What I am intentionally leaving alone
- Dashboard "Recent community chatter" list, trending complaints, model detail charts/breakdowns, research grid, privacy page — all consistent and legible; changing them would add churn without clear benefit.
- Color palette stays (dark theme, sentiment green/amber/red). No token changes.

## Technical
- `src/components/HeroVibeGauge.tsx`: removed.
- `src/pages/Index.tsx`: centered single-column hero; no gauge; no `avgScore`.
- `src/pages/Rumors.tsx` (or the rumor card component): equal-height cards in a row.
- No backend, no routing, no dependency changes.

## Verification
- `npm run build` passes; `npm run test` and `tsgo` clean.
- Fixed-viewport Playwright screenshots at 390 / 768 / 1024 / 1440 confirming: hero is centered and gauge-free; rumor cards equal height; live model score cards remain unchanged.
