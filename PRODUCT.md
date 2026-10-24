# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

> Three web apps: customer (mobile-first), seller and admin back-offices
> (desktop-primary). No native app.

## Mission

bibs sostiene e promuove il commercio del proprio nucleo cittadino, dando
visibilità alle migliaia di esercenti che rendono le città vive, vibranti e
dinamiche. Molti acquisti online nascono da una mancanza di conoscenza, non
da una mancanza di offerta locale: il negozio a pochi passi da casa vende
spesso il prodotto che cerchiamo, e non lo sappiamo. Ogni saracinesca che si
abbassa è una sconfitta per la comunità.

> The belief above has no sourced figure yet. Do not attach a percentage or
> statistic to it until one is sourced (see Evidence on Hand).

The mission carries five concrete commitments:

1. **Visibility for local merchants.** Make the offer that already exists
   nearby legible to the people who walk past it every day.
2. **Community before transaction.** Growth of bibs is growth of the
   neighborhood itself; never grow at the merchant's expense.
3. **A reward system that stays local.** Every purchase generates points
   redeemable at other participating shops in the same territory, sustaining
   the economia di prossimità.
4. **Speed without the warehouse.** Reservation or purchase in seconds, with
   pickup in store or delivery, customer's choice.
5. **km 0 by default.** Avoid the thousand-kilometre shipment when the same
   product is on the way home. Sustainability is operational, not a slogan.

## Vision

Rimettere al centro il commercio di prossimità grazie a un nuovo connubio: la
tempestività e performance dello shopping online insieme alla cura e fiducia
dell'acquisto in negozio. Three structural beliefs follow:

1. **A new way to shop.** bibs becomes the default reflex for "I need this,
   locally, today" rather than the second choice after Amazon.
2. **360° civic involvement.** Amministrazioni and organi istituzionali
   participate as partners (incentives, premi, recognition) through the same
   system shoppers and merchants use.
3. **Collective growth.** A behavioral and structural change, not a campaign.
   The product succeeds when the relationship between people and tessuto
   sociale shifts.

## Users

**Shoppers** are mixed-age Italian residents (20s through 60s+) defined less
by demographic than by trust orientation. They care who runs the shop, where
it is, whether it's open right now, what else that shopkeeper sells. They
reach for bibs when Amazon feels wrong (gift, support local, need now, want a
face) and abandon when an interface feels generic, anonymous, or theatrical.
Mobile-primary, but not "design forward".

**Merchants** are independent Italian retailers (1 to 10 employees) running a
single shop or a small chain. They onboard, manage products, store hours,
team, orders, pickup and delivery handoffs. Most are part-time operators of
their digital storefront; the back-office must respect that.

**Civic partners** are Comuni and local administrations that join the bibs
network to offer incentivi and premi to participating merchants and shoppers.
They are not direct UI users in MVP, but their participation is a first-class
signal on customer surfaces ("il Comune di X partecipa al progetto bibs").

**Admins** are the bibs platform team. Few users, internal tooling.

## Product Purpose

bibs is a curated local-commerce marketplace for Italian neighborhoods, built
around three loops:

1. **Discovery.** Make nearby shops findable, identifiable, and reachable
   before search; surface "the shop next door sells what you wanted".
2. **Reservation and purchase.** Few-tap booking, pickup or delivery, with
   the merchant's identity carried through every screen.
3. **Reward.** Points earned at participating shops spend back in the same
   territory, with civic incentives layered on top.

Success is when a shopper picks bibs over Amazon for a specific local need;
when a merchant publishes their first product without help; and when a Comune
points to bibs as part of its commercial-policy toolkit.

## Positioning

A marketplace where the shop, not the catalogue, is the product. Every
listing belongs to a named merchant a few streets away, and the transaction
ends at that merchant's counter: the customer picks up in store with a code,
so there is no warehouse and no courier between them. The money model is
aligned with the shop rather than against it: merchants pay a flat monthly
fee per store, bibs takes a commission only on orders paid online, and the
points discount is paid by bibs, never by the shop. Mass marketplaces cannot
copy this without giving up interchangeable inventory and their own
logistics.

## Operating Context

- **Pilot territory: Bologna.** Seed data mirrors it (86 fictional stores);
  a Milano store exists only as the dev account's shop.
- **Customer app** on the phone, often on the move: find shops and products
  around a location, check whether a shop is open now, order, then walk to
  the shop and show the pickup code.
- **Seller back-office** on a desktop or laptop in the shop, used by the
  owner and assigned employees between customers: catalogue (EAN lookup,
  brand, category, characteristics, VAT), stock per store, opening hours,
  closures and holidays, promotions, team, incoming orders and pickups,
  online payments setup and the store subscription.
- **Admin back-office** for the bibs team: seller onboarding and identity
  verification, category and characteristics dictionaries (CSV import),
  stores, products, collections and billing.
- **Order types a store can offer:** «Prenota e paga in negozio» (reserve
  online, pay at the counter, outside bibs) and «Paga e ritira» (pay online
  by card, pick up in store; requires the merchant's Stripe Connect account).
  Reservations stay valid for a window of 1–72 opening hours set by the
  shop (default 24).
- **Language:** Italian first, English secondary; every user-facing string
  exists in both.

## Capabilities and Constraints

- **Payments:** Stripe. Store subscription via Stripe Billing (default 29 €
  per store per month). «Paga e ritira» via Stripe Connect with separate
  charges and transfers: bibs is merchant of record, pays the Stripe fees
  and keeps a 5% commission.
- **Points:** 1 point per euro paid, earned when the merchant completes the
  order; 100 points = 1 €; spendable only on «Paga e ritira» because bibs
  funds the discount. Today the balance is one per customer and is not
  limited to a territory.
- **Not built (do not present as available):** delivery («Paga e
  spedizione» exists in the order model but no checkout offers it); in-store
  QR purchase (`direct`, disabled); territory-bound points; civic partner
  programme and Comune incentives.
- **Status:** in development, not deployed; no real users yet.
- **Terminology:** macrocategoria / categoria (product and store
  taxonomies), caratteristiche (per-category product attributes), negozio,
  venditore/titolare, dipendente, ritiro, codice di ritiro.

## Brand Commitments

Warm, curated, neighborly. The wordmark is rounded and almost handwritten,
the symbol is an open hand offering. That is the voice: someone vouching for
the shop next door, not a brand selling itself. Confident without selling
hard, slow without being precious, immediate without being frantic. Italian
first; copy is human and direct, never marketing-jargon ("Powerful tools to
grow your shop" is forbidden).

Tonal sweet spot: between the identity-led storefronts of Depop / Vinted and
the geolocation-forward immediacy of Glovo / Gorillas, with a civic and km-0
commitment neither pole carries.

Brand assets: `apps/customer/public/brand/logo.svg`, the `BrandMark`
component in `packages/ui/src/custom/brand-mark.tsx`, logo drafts and brief
in `docs/brand/`.

## Anti-references

- **Amazon, eBay, Subito.** Mass marketplace aesthetics: infinite anonymous
  product grids, yellow CTAs, density over clarity. bibs displaces this.
- **Generic SaaS template.** Gradient hero, identical icon-heading-text card
  grids, "AI-coded" Stripe-clone landing pages, the hero-metric pattern.
  bibs is not a B2B tool selling itself.
- **Crypto, web3, dark-neon tech.** High-saturation gradients on black,
  glassmorphism, futuristic typography. Wrong register entirely.
- **Italian classifieds (Subito, Bakeca).** Dated UI, ad-heavy,
  blue-and-orange corporate, low trust signals.
- **Coupon and cashback aggregators (Groupon style).** Loud %-off stickers,
  countdown timers, manipulative urgency. The reward system is part of an
  economic relationship, not a manipulative hook.

## Evidence on Hand

None yet. There are no live merchants, partner Comuni, customers,
testimonials, case studies, press or usage metrics. Seed data (stores,
products, sellers, orders) is fictional and must never be presented as real.
The "acquisti online da mancanza di conoscenza" belief has no sourced figure.
Future work must not invent any of these.

## Product Principles

1. **Trust through identity, not volume.** Every customer screen leads with
   "who runs this shop": face, name, place, voice. Surfaces that bury the
   merchant under the inventory are wrong by default. Counter to the Amazon
   model of interchangeable inventory.
2. **Neighborhood is the unit.** Distance, opening hours, pickup, and the
   shop's place in the neighborhood are first-class signals, not detail-page
   footnotes. Maps and presence states are part of the primary identity of
   every product and every store.
3. **Reward is connective tissue.** The loyalty system runs through
   discovery, browsing, and post-purchase, never bolted onto a checkout
   footer. Points are visible while users plan, not only when they pay.
4. **km 0 is a state of the product.** Distance, provenance, and the avoided
   shipping are present without the user asking. Sustainability is shown
   structurally, not claimed in copy.
5. **Calm for mixed users.** A 60-year-old shopper and a part-time shop
   employee both get through a screen in one pass: predictable rhythm, plain
   language, state by label and shape, no self-describing marketing copy.

## Accessibility & Inclusion

WCAG 2.2 AA across all three apps. Non-color status signals (icon, label,
text) for any state that matters. `prefers-reduced-motion` collapses all
non-essential animation to fades and instant transitions. Color-blind safe
palette tested for the three common deficiencies. Italian first, English as
secondary; copy avoids idioms that don't translate. Hit targets 44px+ on the
customer app (mobile-first), 36px+ on seller and admin (desktop-primary).
