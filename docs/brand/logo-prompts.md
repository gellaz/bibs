# bibs logo: image-generator prompts

Direction selected: **B. Mano-led + wordmark sotto.** Generate the open-palm symbol as primary mark, with the lowercase "bibs" wordmark below in a rounded grotesque sans-serif. Navy ink on warm cream, single saffron offering dot in the palm.

These prompts are tuned per platform. Run them, pick what works, iterate. Feed the best output back into a designer brief if you want a polished finale (see `logo-brief.md`).

## Recraft V3 (Logo Raster style — best for logo work today)

Set style: **Logo Raster** or **Vector Illustration**. Aspect 1:1.

```
Minimal flat vector logo for "bibs", a curated local-commerce marketplace
for Italian neighborhoods. Mark: an open hand, palm up, offering, drawn
with a single clean continuous line, slightly architectural geometry,
not overly cute. Above the mark: lowercase wordmark "bibs"
in a rounded warm grotesque sans-serif (Bricolage Grotesque feel),
weight semi-bold, slightly negative letter-spacing. Color: deep navy
ink #2f3f76. Centered, balanced, generous negative space, flat 2D. No gradient. No 3D. No shadow. No glow.
```

Negative / avoid:

```
gradient, drop shadow, glassmorphism, 3D, realistic skin, character
face, anatomy details, neon, cyan, sky blue, Amazon yellow, gold,
Stripe-style geometry, crypto neon, SaaS template, gradient text,
yellow CTA, photo-realism, beveled edges, glow, sparkles
```

## Midjourney v6 / v7

```
minimal vector logo, single-line open palm hand offering, navy ink
#2f3f76 on warm cream #fbf8f0 background, small saffron #e6b057 dot
in palm, lowercase wordmark "bibs" below in rounded warm grotesque
sans-serif, generous negative space, Italian editorial neighborhood
brand, like Cereal magazine x Glovo, flat 2D, square composition
--style raw --ar 1:1 --no gradient, 3d, shadow, glow, neon, cyan,
photo
```

Variant for a more architectural mark (sterner geometry):

```
minimalist geometric logo, open palm offering, single continuous line,
navy ink, small saffron dot resting in palm, lowercase italic-feeling
sans-serif wordmark "bibs" below, warm cream background, Pentagram-style
identity design, editorial Italian commerce brand --style raw --ar 1:1
--no gradient, shadow, 3d, glow
```

## Ideogram (best at rendering legible text in image gen)

```
Logo design for "bibs", lowercase, rounded warm grotesque sans-serif
typography, semi-bold, navy color #2f3f76, paired with a minimalist
hand symbol above it: an open palm in offering gesture, single-line
vector drawing, single small saffron yellow accent circle inside the
palm. Cream background #fbf8f0. Vector flat 2D style. Italian local
neighborhood marketplace brand. Calm, warm, confident, not playful, not
corporate. No gradient, no shadow, no glow, no 3D.
```

## Adobe Firefly (commercial-safe, no training-set IP risk)

Set Content Type: **Art**. Style: **Vector look**. Aspect 1:1.

```
Open palm pictogram, palm up, offering gesture, drawn with a single
continuous line, small saffron yellow accent circle in palm. Below the
symbol: lowercase wordmark "bibs" in rounded warm sans-serif typography.
Deep navy ink color on warm cream background. Minimal Italian editorial
style. Flat 2D, no shadows, no gradients, generous negative space.
```

## Iteration tips

- **Recraft is the strongest** for clean logo output today. Start there with 4-8 generations, pick the best 2, then use Recraft's "vectorize" feature to get editable SVG.
- **Midjourney** is best for stylistic exploration before committing. Use it to sample 12-16 vibes, screenshot the strongest, then re-prompt Recraft with that as a reference.
- **Ideogram** is the only one that gets the "bibs" text reliably right. Use it for wordmark-led variations.
- **Firefly** if you need licensed-clean output for commercial use without IP concerns.

## Anti-patterns to spot in generated output

Reject any generation that includes:

- A heart, smile, hug, or other "warm fuzzy" cliché (we are warm, not saccharine).
- A shopping bag, basket, cart icon (mass-marketplace cliché).
- A pin/marker icon (geo cliché; bibs surfaces geo via UI, not via mark).
- A stylized "b" merged with a hand (forced, usually awkward).
- Multiple competing accents (we have ONE saffron dot; reject if there are stripes, gradients, or extra colors).
- Italian flag colors (red/white/green), tricolore patterns, "Italian" stereotype iconography. The brand is Italian by audience, not by flag.
- A wordmark that looks like a generic Stripe / Linear / Vercel sans-serif. We need a warmer, slightly humanist character.
- Realistic hand anatomy with detailed knuckles and fingernails. The mark is a pictogram, not an illustration.

## File handoff

Once you have a candidate:

1. Vectorize in Recraft (or import to Figma, Illustrator, Affinity Designer).
2. Calibrate exact colors against DESIGN.md frontmatter:
   - Ink: `oklch(0.34 0.10 258)` (≈ `#2f3f76` in sRGB; verify in your color tool).
   - Saffron: `oklch(0.78 0.14 75)` (≈ `#e6b057`).
   - Cream: `oklch(0.985 0.008 80)` (≈ `#fbf8f0`).
3. Convert wordmark text to outlines so the SVG has no font dependency.
4. Export full deliverable set per the spec in `logo-brief.md`.
