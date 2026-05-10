# Brand assets and references

Brand source-of-truth for bibs. All visual decisions cascade from [`PRODUCT.md`](../../PRODUCT.md) and [`DESIGN.md`](../../DESIGN.md) at the repo root.

## Index

| File | Purpose |
|---|---|
| [`logo-brief.md`](logo-brief.md) | Full designer brief for the next iteration of the logo. Self-contained; suitable for handoff to a freelance or studio. |
| [`logo-prompts.md`](logo-prompts.md) | Image-generator prompts (Recraft, Midjourney, Ideogram, Adobe Firefly) tuned to direction B and the bibs palette. |
| [`logo-draft-b-lockup.svg`](logo-draft-b-lockup.svg) | SVG starter draft, direction B (mark-led + wordmark below). Pictogrammatic; iterate in Figma or feed to a designer. |
| [`logo-draft-b-mark.svg`](logo-draft-b-mark.svg) | Mark-only token (open-palm glyph in cream square), favicon-ready. |
| [`logo-draft-b-wordmark.svg`](logo-draft-b-wordmark.svg) | Wordmark only, "bibs" in Bricolage Grotesque. Convert text to outlines before final delivery. |

## Current placeholder logo

The current logo lives at [`apps/customer/public/brand/logo.png`](../../apps/customer/public/brand/logo.png). At runtime on the customer app it serves as `/brand/logo.png`. The file is the canonical, evolving brand asset: future iterations replace it in place. Historical drafts (if useful) belong in Git history or under `docs/brand/archive/`.

It is **not the final mark**. It carries the right concept (open palm offering, navy wordmark) but needs refinement against [`logo-brief.md`](logo-brief.md):

- Mark and wordmark feel detached vertically; new direction is mark-led with a balanced lockup.
- Wordmark proportions are uneven (the dot of "i", the terminal of "s"). The next iteration tightens to a Bricolage Grotesque or custom-tuned wordmark.
- No mark-only variant exists; needed for favicon, app icon, avatar contexts.
- The pale-blue background is a PNG artefact, not a brand value. Final assets should be transparent or on Cream.

## Direction selected

**B. Mark-led + wordmark below.** The open-palm symbol is the primary mark; "bibs" wordmark sits below in lockup. Reasons in [`logo-brief.md`](logo-brief.md) §3.

## Color reference (from DESIGN.md)

| Role | OKLCH | Hex (≈) |
|---|---|---|
| Ink | `oklch(0.34 0.10 258)` | `#2f3f76` |
| Cream | `oklch(0.985 0.008 80)` | `#fbf8f0` |
| Saffron | `oklch(0.78 0.14 75)` | `#e6b057` |

OKLCH is canonical. Hex is an sRGB approximation.

## Workflow for iterating

1. Open the SVG drafts directly in a browser to evaluate the geometry.
2. For fast exploration, run [`logo-prompts.md`](logo-prompts.md) in Recraft or Midjourney.
3. For a polished finale, send [`logo-brief.md`](logo-brief.md) to a designer. Brief is self-contained.
4. When a new mark is approved, replace `apps/customer/public/brand/logo.png` with the new file and update `DESIGN.md` if any tokens shift.
