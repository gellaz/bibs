# bibs: logo design brief

For freelance designers, studios, or agencies. This brief is self-contained, but the design system source of truth lives in [`PRODUCT.md`](../../PRODUCT.md) (strategic) and [`DESIGN.md`](../../DESIGN.md) (visual). Read both before starting; they are short.

## 1. Project

**bibs** is a curated local-commerce marketplace for Italian neighborhoods. It surfaces the offer of independent shops near where users live (clothing, food, home, electronics, books, sports), with reservation and pickup-or-delivery, a loyalty system that keeps points within the same territory, and partnerships with local Comuni who add civic incentives on top.

The product positions itself against:

- The mass-marketplace anonymity of Amazon / eBay / Subito.
- The generic SaaS-template aesthetic of Stripe-clones and gradient hero pages.
- The classifieds-era Italian commerce sites (Subito, Bakeca: blue-and-orange, ad-heavy).
- Coupon-aggregator manipulation (Groupon: %-off stickers, countdown timers).

The product positions itself with:

- The identity-led storefronts of Depop / Vinted (each shop has a face).
- The geolocation-forward immediacy of Glovo / Gorillas (distance, presence, "aperto adesso").
- A civic / km-0 commitment neither pole carries.

## 2. North Star

**The Open Hand.**

The interface is shaped like the gesture in its own logo: an open hand, palm up, offering. Confident enough to slow down. Generous with space around the merchant, the product, the place. Not pulling, not pushing. The voice is the same as a neighbor pointing across the road and saying "lì, da Marco, hai trovato."

## 3. Direction selected

**B. Mark-led, wordmark below.** The open-palm symbol is the primary mark; the lowercase "bibs" wordmark sits below it in lockup. Reasons:

- The mark carries the North Star directly. It is the brand argument compressed into a glyph.
- It scales: the mark alone works at 16px (favicon), 80px (avatar), and freely on print without competing with the wordmark.
- It's distinctive against category-reflex marketplace logos (no shopping bag, no map pin, no curly script).

Three other directions were considered and rejected: wordmark-refined (loses the gesture), hand-cradling-wordmark (hard to scale, fragile at small sizes), wordmark-only with hand-suggesting glyph quirks (clever but corporate).

## 4. Deliverables

The full handoff includes:

### Marks

- **Primary lockup** (mark + wordmark below): horizontal balance OK, but vertical lockup is the canonical form because it scales better in app contexts. Both should be delivered.
- **Mark only** (open-palm glyph alone): for favicon (16, 32, 64, 192px), app icon (512, 1024px), avatar contexts.
- **Wordmark only**: for letterhead, large display contexts where the mark would be redundant.

### Variants per mark

- Default: Ink on Cream / transparent.
- Knockout (light on dark): Cream on Ink, for navy-dominant surfaces.
- Monochrome: pure Ink only, no Saffron dot. For one-color print (newspapers, faxes still exist), embroidery, single-color stamps.
- With Saffron dot: the offering accent in the palm. This is the *brand-rich* version. Use on customer-facing surfaces (signup, splash, hero, app store listing).
- Without Saffron dot: cleaner, more institutional. Use on legal pages, footer, dense UI chrome.

### File formats

- **SVG** (master, with text converted to outlines so there's no font dependency).
- **PNG** at 1x, 2x, 3x for web, plus 16/32/64/180/192/512/1024 for favicon and app icon sets.
- **PDF** vector for print.
- **AI** or **Figma** source file with named layers, organized swatches, and editable wordmark.

### Spec sheet

A one-page PDF showing:

- Clear-space rules (minimum margin around the mark, expressed as a multiple of the mark's x-height).
- Minimum sizes (digital and print).
- Color usage rules (when to use each variant, when to use Saffron, when not).
- Misuse examples (don't stretch, don't recolor outside palette, don't add gradient, don't put on busy photography without a Cream wash, etc).

## 5. Visual constraints

### Color palette (from DESIGN.md)

| Role | OKLCH | Hex (≈) | Usage |
|---|---|---|---|
| Ink | `oklch(0.34 0.10 258)` | `#2f3f76` | Mark stroke, wordmark fill, default brand voice |
| Cream | `oklch(0.985 0.008 80)` | `#fbf8f0` | Default background. Never pure white |
| Saffron | `oklch(0.78 0.14 75)` | `#e6b057` | The offering dot in the palm. Maximum 5% of the mark area |

OKLCH is canonical. Hex is an sRGB approximation; verify exact values in a color-managed tool.

Pure `#000` and pure `#fff` are prohibited everywhere in the brand system, including the logo.

### Typography (wordmark)

- Family direction: **rounded warm grotesque sans-serif**. Reference: Bricolage Grotesque (Indian Type Foundry), Cabinet Grotesk (Indian Type Foundry), General Sans, or a custom-tuned wordmark.
- Weight: 500 to 600 (semi-bold).
- Case: lowercase always. The "bibs" lowercase reads as approachable, neighborly, not corporate.
- Letter-spacing: slightly negative (-0.015em to -0.02em) to feel held together.
- Convert to outlines in the final SVG / vector deliverable.

### Mark geometry

- An **open palm**, viewed slightly from above so the palm and fingers are both visible.
- **Single continuous outline** preferred (echoes the existing draft's aesthetic but more controlled). Acceptable alternative: minimal multi-stroke if it scales better.
- **Stroke** rather than fill, with stroke weight chosen to remain legible at 16px.
- **Rounded line caps and joins** (matches the wordmark's rounded character).
- **Saffron offering dot** centered in the palm, sized 4-6% of the mark's bounding box.
- The hand should feel **architectural-yet-warm**: not anatomically precise (no knuckles, no fingernails), not childishly cute (no cartoon proportions). Think pictogram with a pulse.

### What the mark should NOT include

- A shopping bag, basket, cart, or other commerce cliché.
- A map pin or geo marker (we surface geo via UI, not via the mark).
- A heart, smile, or "warm fuzzy" cliché.
- Letters of "bibs" hidden inside the hand (avoid the forced monogram-trick).
- Multiple accent colors. Saffron is the only accent.
- Gradient, shadow, glow, glassmorphism, 3D, beveled edges.
- Italian flag colors or tricolore patterns. The brand is Italian by audience, not by flag.

## 6. Tone references

In the right register:
- Cereal magazine, Apartamento, Kinfolk: editorial restraint, Italian-friendly aesthetic.
- Slowear, Tessabit, Pal Zileri (Italian retail with quiet confidence): warm typography, restrained color.
- Glovo (the geo immediacy half): minimal pictogram, recognizable at app-icon scale.
- Depop (the identity-led half): personality without theater.

In the wrong register, explicitly:
- Amazon, Mercari, eBay (mass marketplace).
- Stripe, Vercel, Linear (SaaS-template).
- Coinbase, OpenSea, Phantom (crypto-neon).
- Subito, Bakeca (Italian classifieds).
- Groupon, Wish (coupon-manipulation).

## 7. Process

Suggested workflow:

1. **Round 1 — exploration.** Three to five conceptual sketches of the mark, monochrome only, no wordmark. Each demonstrates a different geometric interpretation of "open palm offering". Sketch level OK; we choose direction here.
2. **Round 2 — refinement.** Selected mark refined to vector. Wordmark drafts pair-tested against the mark. Lockup balance studied (vertical primary; horizontal alternative).
3. **Round 3 — system.** All variants and formats produced. Spec sheet drafted. Misuse examples drawn.
4. **Round 4 — validation.** Mark tested at 16px favicon, on a busy photograph, on a navy background, in greyscale photocopy. Adjustments to stroke weight, kerning, contrast based on real-world constraints.

## 8. Timeline & budget

[To be filled by the bibs team.]

Rough order-of-magnitude expectations: a thoughtful single-designer engagement on this scope runs 4-6 weeks and €3.5k-€8k EUR. A studio engagement (with strategy, system, full spec sheet, application examples) runs 8-12 weeks and €15k-€40k EUR. The brief above suits both.

## 9. Reference materials in this repo

- [`PRODUCT.md`](../../PRODUCT.md): strategic foundation, full anti-references, design principles, accessibility baseline.
- [`DESIGN.md`](../../DESIGN.md): visual system, color palette, typography, components, named rules.
- [`.impeccable/design.json`](../../.impeccable/design.json): machine-readable design tokens.
- [`logo-prompts.md`](logo-prompts.md): image-generator prompts for fast exploration before or alongside the design engagement.
- Current iteration at [`apps/customer/public/brand/logo.svg`](../../apps/customer/public/brand/logo.svg): Recraft-generated mark (direction B), retinted to the bibs palette (Ink + Cream). Lockup as a square Ink-on-Cream tile. Still needs a type-tuned wordmark (Bricolage-aligned or custom), a separate mark-only variant, and transparent/knockout variants for varied surfaces.

## 10. Contact

Project lead: [bibs team contact].

Repository: [GitHub URL once public].

Decisions log: any major direction changes should be reflected in PRODUCT.md / DESIGN.md so the rest of the system stays coherent.
