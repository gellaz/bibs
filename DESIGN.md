---
name: bibs
description: "Open-handed local commerce: navy ink on warm cream, for Italian neighborhoods."
colors:
  ink: "oklch(0.34 0.10 258)"
  ink-deep: "oklch(0.24 0.08 258)"
  ink-soft: "oklch(0.46 0.10 258)"
  cream: "oklch(0.985 0.008 80)"
  warm-paper: "oklch(0.965 0.012 80)"
  warm-edge: "oklch(0.91 0.012 80)"
  warm-line: "oklch(0.86 0.014 80)"
  dusk: "oklch(0.22 0.014 80)"
  warm-shadow: "oklch(0.50 0.012 80)"
  saffron: "oklch(0.78 0.14 75)"
  saffron-deep: "oklch(0.66 0.16 70)"
  brick: "oklch(0.55 0.18 25)"
  olive: "oklch(0.62 0.10 135)"
  ink-on-saffron: "oklch(0.22 0.014 80)"
  ink-on-brick: "oklch(0.985 0.008 80)"
typography:
  display:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 6vw, 4.25rem)"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.625rem, 3vw, 2.125rem)"
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.04em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "0.25rem"
  md: "0.425rem"
  lg: "0.625rem"
  xl: "0.875rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2.5rem"
  3xl: "4rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.625rem 1.125rem"
  button-primary-hover:
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.cream}"
  button-secondary:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.625rem 1.125rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.875rem"
  input:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.dusk}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.625rem 0.875rem"
  card:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.dusk}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  badge-saffron:
    backgroundColor: "{colors.saffron}"
    textColor: "{colors.ink-on-saffron}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.625rem"
  badge-civic:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.75rem"
  distance-pill:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.625rem"
---

# Design System: bibs

## 1. Overview

**Creative North Star: "The Open Hand"**

bibs is shaped like the gesture in its own logo. An open hand offering, palm
up, neither pulling nor pushing. The interface is confident enough to slow
down: it makes room around the merchant, the product, the place. Where
Amazon collapses everything into a yellow-CTA grid, bibs leaves space for a
shop's name, its street, the hours it keeps today. The voice is the same as
a neighbor pointing across the road and saying "lì, da Marco, hai trovato".

Two surface idioms run inside this metaphor without breaking it:
**The Shopkeeper's Window** governs every merchant detail page (a vetrina
that opens, photo-led, with the shop's identity above the inventory), and
**The Market Square** governs discovery and home (a live square: presence,
distance, "aperto adesso", civic chips). The parent metaphor decides the
tone; the surface idioms decide the rhythm of a particular page.

This system explicitly rejects: the Amazon mass-marketplace grid (yellow
CTAs, density over clarity, anonymous merchants); the generic SaaS template
(gradient hero, identical icon-heading-text card grids, hero-metric
pattern); coupon and cashback aggregator aesthetics (loud %-off stickers,
manipulative urgency); Italian classifieds (Subito, Bakeca: ad-heavy,
blue-and-orange corporate); crypto / web3 dark-and-neon. Anything that
treats the shopper as a conversion or the merchant as a SKU is wrong by
default.

**Key Characteristics:**

- Navy ink on warm cream, never pure white, never black. The page reads like
  a printed map, not a dashboard.
- Generous spacing as a moral position. The merchant gets room.
- Typography pairs Geist (UI workhorse) with Bricolage Grotesque (warm
  display). Two voices, one register.
- Saffron is the only saturated accent and it is rare. ≤5% of the surface,
  signal moments only (reward earned, civic partner, "aperto adesso", focus).
- Flat by default. Elevation is reserved for state response.
- Motion respects `prefers-reduced-motion` without exception. Ease-out
  exponential curves, no bounce.

**Migration note.** The codebase as of writing carries the shadcn radix-nova
preset (cyan-sky `--primary`, neutral grayscale, Geist-only). DESIGN.md is
normative for new work: the next implementations align tokens to this spec.
Existing screens migrate opportunistically, never as a big-bang refactor.

## 2. Colors: The Ink-and-Paper Palette

A bichromatic system: navy ink on warm cream, with a single saffron signal.
The cream is not white, the ink is not black, and the saffron earns its
visibility.

### Primary

- **Ink** (`oklch(0.34 0.10 258)`): the brand voice. Wordmark, primary
  buttons, headlines on cream surfaces, links, focus rings, navigation
  active state, the writing across the system. Pulled directly from the
  bibs wordmark. Ink, not blue.
- **Ink Deep** (`oklch(0.24 0.08 258)`): hover state for primary buttons,
  pressed states, the strongest emphasis. Used sparingly.
- **Ink Soft** (`oklch(0.46 0.10 258)`): secondary navigation, deemphasized
  links, ink at half-voice.

### Neutral: Warm Paper

The neutrals tint toward warm yellow (hue 80, chroma ≤0.014), not toward
the brand ink. The cream is the territory; the ink draws on it.

- **Cream** (`oklch(0.985 0.008 80)`): page background. Aged paper, never
  pure white. The thing the system writes on.
- **Warm Paper** (`oklch(0.965 0.012 80)`): cards, inputs at rest, sheets.
  A half-shade darker than cream, just enough separation.
- **Warm Edge** (`oklch(0.91 0.012 80)`): default borders and dividers,
  input strokes.
- **Warm Line** (`oklch(0.86 0.014 80)`): pressed borders, table rules
  when emphasized.
- **Warm Shadow** (`oklch(0.50 0.012 80)`): muted text, helper copy,
  metadata (timestamps, addresses in long form).
- **Dusk** (`oklch(0.22 0.014 80)`): primary foreground text on cream.
  Tinted ink, not pure black.

### Accent: Saffron

A single saturated color, used for signal moments only.

- **Saffron** (`oklch(0.78 0.14 75)`): reward earned, points balance,
  civic partner pill ("il Comune partecipa"), "aperto adesso", new badge,
  focus ring at critical moments.
- **Saffron Deep** (`oklch(0.66 0.16 70)`): hovered or pressed saffron
  surfaces, smaller saffron text on cream where contrast matters.

### State

- **Brick** (`oklch(0.55 0.18 25)`): destructive actions, error text,
  destructive button background. A red that lives in the same warm family
  as the cream, not a pure alert red.
- **Olive** (`oklch(0.62 0.10 135)`): success and km-0 affirmative
  signals (delivery confirmed, order placed, "consegna a 0.4 km"). A
  vegetable green, not a SaaS lime.

### Named Rules

**The Single Hand Rule.** Saffron is the open palm. It belongs to ≤5% of
any given screen, and only on signal moments: reward, civic, presence,
focus. Never as a decorative accent, never on body chrome, never on a
gradient. Every additional saffron pixel weakens the one that earned its
place.

**The Ink Rule.** Pure black (`#000`) and pure white (`#fff`) are
prohibited. Foreground is Dusk. Background is Cream. Surfaces with no
chroma feel like a tax form. The whole system tints, slightly.

**The No-Cyan Rule.** The current shadcn preset's cyan-sky primary
(`oklch(0.746 0.16 232.661)`) is legacy and contradicts the wordmark. Do
not introduce new uses; migrate opportunistically. The brand voice is
navy ink, full stop.

## 3. Typography

**Display Font:** Bricolage Grotesque (variable), with a `ui-sans-serif`
fallback. Free via Fontshare / Google Fonts.
**Body Font:** Geist (variable), with `ui-sans-serif`. Already in the repo.
**Mono Font:** Geist Mono. For prices, codes, distances, point balances.

**Character.** Bricolage is a warm grotesque with rounded terminals and a
subtle quirk in its widest weights: a sibling of the wordmark's
hand-marker quality, but disciplined enough for headlines. Geist is the
neutral workhorse. Together they read like a small magazine running on
solid editorial chrome: identity at the top, clarity below.

### Hierarchy

- **Display** (Bricolage 500, `clamp(2.5rem, 6vw, 4.25rem)`, line-height
  1.05, tracking -0.015em): hero on customer brand pages, shop name on
  Shopkeeper's Window detail pages. One per page. Never inside a card.
- **Headline** (Bricolage 600, `clamp(1.625rem, 3vw, 2.125rem)`,
  line-height 1.18): section heads on the customer surface, card-as-hero
  titles, empty-state headlines.
- **Title** (Geist 600, 1.25rem, line-height 1.3): card titles, list
  item primary, dialog titles, settings group heads.
- **Body** (Geist 400, 1rem, line-height 1.55, max line length 65–72ch):
  paragraphs, descriptions, long-form merchant text. Never wider than 72
  characters.
- **Label** (Geist 500, 0.8125rem, line-height 1.3, tracking 0.04em):
  chips, pills, badges, button text, table headers. Sentence case in
  Italian; only the saffron reward badges use ALL CAPS, and only there.
- **Mono** (Geist Mono 400, 0.875rem): prices, distances ("0.4 km"),
  point balances, order codes, addresses in compact form.

### Named Rules

**The Two-Voice Rule.** Bricolage carries identity. Geist carries
information. Mixing roles, putting Bricolage on a price tag or Geist on
a hero, breaks the system. If a piece of text is the *what*, Geist; if
it is the *who* or the *welcome*, Bricolage.

**The 72ch Rule.** Body copy never exceeds 72 characters per line. Above
that the eye loses the line return, the merchant's story stops feeling
like a story.

**The Italian-First Rule.** All scale ratios are tuned on Italian copy,
which runs slightly longer than English. Verify hierarchy with Italian
strings; never tune on Lorem ipsum.

## 4. Elevation

The Open Hand metaphor is calm. Elevation follows: surfaces are flat at
rest; shadow is a response, not a default. There is no ambient glow, no
decorative depth.

A surface lifts only when the user has done something to it. A card on a
home grid is flat; the card the cursor is currently over has the smallest
shadow in the vocabulary. A sheet that the user has just opened is
elevated. A static panel that has been there since page load is not.

### Shadow Vocabulary

- **rest** (none): default. No shadow. A 1px Warm Edge border carries
  separation when needed.
- **xs** (`0 1px 3px 0px hsl(0 0% 0% / 0.05)`): subtle hover lift on
  cards.
- **sm** (`0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 1px 2px -1px hsl(0 0% 0% / 0.10)`):
  hover on buttons and primary surfaces; default on dropdown menus.
- **md** (`0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 2px 4px -1px hsl(0 0% 0% / 0.10)`):
  popovers, comboboxes, persistent menus.
- **lg** (`0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 4px 6px -1px hsl(0 0% 0% / 0.10)`):
  drawers, sheets, the merchant detail Shopkeeper's Window when it
  enters the viewport.
- **xl** (`0 1px 3px 0px hsl(0 0% 0% / 0.10), 0 8px 10px -1px hsl(0 0% 0% / 0.10)`):
  modal dialogs only. Used very rarely; modals are usually laziness.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat. Shadows respond to
state (hover, focus, drag, just-opened). Decorative ambient glow is
forbidden.

**The 1px Border Rule.** Where shadow would be the obvious answer for
separation at rest, use a 1px Warm Edge border instead. The system
prefers a drawn line over a fictional drop shadow.

## 5. Components

For each component, the character first, then the spec.

### Buttons

Calm and confident, never pressed-feeling. The primary button is a
statement of offer ("vai al negozio", "prenota").

- **Shape:** gently curved (rounded `md` = 0.425rem, the Open Palm
  Curve). Small enough to feel restrained, large enough to feel warm.
- **Primary:** Ink background, Cream text, label typography, padding
  0.625rem × 1.125rem. Full width on mobile (≥44px tap target),
  inline-auto on desktop.
- **Hover:** background shifts to Ink Deep over 180ms ease-out-quart.
  No translate, no glow.
- **Focus:** 2px Saffron ring offset 2px from the surface. Saffron is
  reserved for focus on the most critical actions; ghost and secondary
  variants use Ink Soft for focus.
- **Secondary:** Warm Paper background, Ink text, same padding.
- **Ghost:** transparent background, Ink text, smaller padding
  (0.5rem × 0.875rem). For tertiary actions inside cards.
- **Destructive:** Brick background, Cream text. Used only for
  irreversible actions (delete shop, cancel order). Never default.

### Inputs

Inputs are openings, not gates.

- **Shape:** rounded `md` (0.425rem).
- **Style:** Cream background, Warm Edge 1px border, Dusk text, body
  typography, padding 0.625rem × 0.875rem.
- **Focus:** border shifts to Ink, Saffron ring 2px outside the border
  at offset 2px. Smooth 150ms ease-out-quart.
- **Error:** border shifts to Brick, helper text in Brick below the
  input. No icons or red glow; the change in border carries the signal.
- **Disabled:** 60% opacity, Warm Paper background. Cursor: not-allowed.

### Cards

Cards are surfaces, not containers. The Open Hand offers what is on the
card; the card itself disappears.

- **Corner Style:** rounded `lg` (0.625rem). Slightly softer than
  buttons, feels held.
- **Background:** Warm Paper.
- **Shadow Strategy:** flat at rest. Hover lift to `xs`. Never nest a
  card inside a card.
- **Border:** 1px Warm Edge. Borders carry the structure; shadows are
  for state.
- **Internal Padding:** `lg` (1rem) on mobile, `xl` (1.5rem) on
  desktop. Generous, never tight.

### Chips and Pills

Chips carry presence. The system has three meaningful kinds:

- **Saffron Reward Pill** (`badge-saffron`): Saffron background, Dusk
  text, ALL CAPS label, rounded `pill`. Used for "+5 PUNTI",
  "RICOMPENSA SBLOCCATA". One of these per surface, maximum.
- **Civic Pill** (`badge-civic`): Warm Paper background, Ink text, 1px
  Ink border, sentence case. "Il Comune di Modena partecipa". Visible on
  customer surfaces where civic incentives apply.
- **Distance Pill** (`distance-pill`): Cream background, Ink text, mono
  number, "0.4 km" or "12 min a piedi". Visible on every store and
  product card. The Market Square's voice.

### Inputs / Search

The customer search bar is large, unhurried, and holds the cursor.
Default state shows "Cerca nel quartiere…" placeholder. On submit, the
search resolves with location context (geo gate), never anonymous.

### Navigation

- **Customer (mobile-first):** bottom tab bar with 4 destinations
  (home / cerca / premi / profilo). Ink Soft icons at rest, Ink active.
  Active uses a Saffron underline 2px tall — saffron earned, not
  decorative, because reaching the section is the user's choice.
- **Seller / Admin (desktop-primary):** left sidebar in Warm Paper,
  Geist label typography, Ink active, Ink Soft inactive. No icons-only
  collapsed mode by default; words matter.

### Signature Components

**The Shopkeeper's Window (merchant detail).** Hero photo full-bleed,
shop name in Display Bricolage on Cream, address + hours + civic pill
in a strip below. Inventory grid begins below the strip with `2xl`
spacing. The shopkeeper's voice (a short bio, optional) appears in Body
Geist, max 65ch, in Warm Shadow.

**The Market Square (discovery).** A dense but breathing index of
nearby shops. Each tile carries: photo (3:4), shop name (Title), one
inventory teaser line (Body), distance pill, and a Saffron presence
dot (Open) or Warm Shadow (Closed). No price on the tile itself; price
is the merchant's invitation, not the marketplace's hook.

**The Reward Thread (loyalty as connective tissue).** Saffron
appearances are coordinated: a small "+N punti" pill follows the user
across discovery, browsing, cart, and post-purchase, never appearing
twice on the same surface. The thread reads as one voice across pages.

## 6. Do's and Don'ts

### Do

- **Do** lead with the merchant: face, name, place, hours come before
  the inventory grid on every customer surface.
- **Do** use Ink as the brand voice. Wordmark, primary buttons,
  headlines, focus rings: the same Ink everywhere.
- **Do** keep Saffron at ≤5% of any screen, on signal moments only.
- **Do** show distance, opening status, and pickup-or-delivery
  affordances on every store and product card. The Market Square is a
  promise.
- **Do** show the civic pill ("il Comune di X partecipa") wherever
  it's true. The civic partnership is a first-class signal.
- **Do** keep Body lines under 72 characters.
- **Do** tune typography on Italian copy. Test "Salumeria Borgo" on
  the same scale as "Salumeria di Borgo Vecchio Padova". Both must read
  one-pass.
- **Do** keep the system flat by default. Surfaces lift only on state.
- **Do** respect `prefers-reduced-motion` without an opt-out. State
  changes collapse to fades.
- **Do** ease out with exponential curves
  (`cubic-bezier(0.22, 1, 0.36, 1)` or steeper). 150-220ms for state,
  280-380ms for layout.

### Don't

- **Don't** introduce new uses of the cyan-sky `--primary`. The brand
  is navy Ink. The cyan is legacy.
- **Don't** use pure `#000` or `#fff`. Anywhere. Foreground is Dusk;
  background is Cream.
- **Don't** use a side-stripe border (`border-left: Npx solid <color>`)
  with N > 1px as a colored accent on cards, list items, callouts, or
  alerts. Rewrite with a full border, a background tint, a leading icon,
  or nothing.
- **Don't** use gradient text (`background-clip: text` over a gradient).
  Emphasis comes from weight or size, not from rainbow ink.
- **Don't** use glassmorphism or backdrop-blur as decoration. Rare and
  purposeful, or absent.
- **Don't** ship the SaaS hero-metric template (big number / small
  label / supporting stats / gradient accent). bibs is not a B2B tool
  selling itself.
- **Don't** ship identical icon-heading-text card grids (the
  three-feature SaaS landing pattern).
- **Don't** ship Amazon-style yellow CTAs, infinite anonymous product
  grids, or density-over-clarity layouts. That is the aesthetic bibs
  displaces.
- **Don't** ship Groupon-style coupon stickers, countdown timers, or
  manipulative urgency. The reward system is a relationship, not a hook.
- **Don't** put crypto / web3 / dark-and-neon energy anywhere. Wrong
  register entirely.
- **Don't** put Bricolage on a price or a button. Bricolage is the
  *who*; Geist is the *what*.
- **Don't** nest a card inside a card. Reach for spacing or a divider
  instead.
- **Don't** wrap everything in a container with the same padding. Vary
  the rhythm; spacing is part of voice.
- **Don't** reach for a modal as the first thought. Inline and
  progressive paths almost always exist; use them.
