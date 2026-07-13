# Footer Link Color Harmonization

## Problem
In the footer nav, "GitHub" uses `text-foreground` (full-brightness white) while "Privacy" inherits `text-text-tertiary` (dim grey) from the parent. Neither link is more important than the other, so the brightness gap reads as an accidental inconsistency — exactly what the annotation flags. The bright GitHub also competes with the genuinely-emphasized "David Kelly" author link to its left.

## Fix
Make both footer nav links share one calm, consistent resting color with a clear hover lift:
- Set both **GitHub** and **Privacy** to `text-text-secondary` at rest (a lighter grey than today's GitHub is too bright and today's Privacy is too dim — this lands between them).
- Both already animate `hover:text-foreground` via `LINK_CLASS`, so hover/focus gives the interactive payoff.
- Remove the one-off `text-foreground` override on the GitHub `<a>` so it no longer stands out from Privacy.

This preserves the visual hierarchy: the "David Kelly" author link stays the single emphasized element in the footer (brighter + primary-hover), while the two utility nav links sit quietly and equally beside it.

### Technical
- `src/components/Footer.tsx`: change the GitHub link `className` from `` `${LINK_CLASS} text-foreground` `` to `` `${LINK_CLASS} text-text-secondary` ``, and add `text-text-secondary` to the Privacy `Link` so both are explicit and equal (rather than relying on inherited tertiary).
- No token/CSS changes, no other components touched.

## Wider polish review
I reviewed the homepage (hero, live model cards, "How it works", footer) at desktop/tablet/mobile. Aside from this footer mismatch, the surfaces hold up and follow the restraint contract — no further changes proposed, to avoid churn. If you want, I can do a deeper dedicated pass on a specific page (e.g. `/dashboard`, `/rumors`, or a model detail page) as a follow-up.

## Verification
- `npm run build` passes.
- Playwright footer screenshot at desktop confirming GitHub and Privacy now read at equal weight, with David Kelly still the emphasized link.
