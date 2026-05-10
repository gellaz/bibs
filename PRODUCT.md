# Product

## Register

brand

> Customer is the brand-default surface. Seller and admin back-offices override
> to `product` per task.

## Mission

bibs sostiene e promuove il commercio del proprio nucleo cittadino, dando
visibilità alle migliaia di esercenti che rendono le città vive, vibranti e
dinamiche. Il 65% degli acquisti online nasce da una mancanza di conoscenza,
non da una mancanza di offerta locale: il negozio a pochi passi da casa vende
spesso il prodotto che cerchiamo, e non lo sappiamo. Ogni saracinesca che si
abbassa è una sconfitta per la comunità.

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

## Brand Personality

Warm, curated, neighborly. The wordmark is rounded and almost handwritten,
the symbol is an open hand offering. That is the voice: someone vouching for
the shop next door, not a brand selling itself. Confident without selling
hard, slow without being precious, immediate without being frantic. Italian
first; copy is human and direct, never marketing-jargon ("Powerful tools to
grow your shop" is forbidden).

Tonal sweet spot: between the identity-led storefronts of Depop / Vinted and
the geolocation-forward immediacy of Glovo / Gorillas, with a civic and km-0
commitment neither pole carries.

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

## Design Principles

1. **Trust through identity, not volume.** Every customer screen leads with
   "who runs this shop": face, name, place, voice. Surfaces that bury the
   merchant under the inventory are wrong by default. Counter to the Amazon
   model of interchangeable inventory.
2. **Neighborhood is the unit.** Distance, opening hours, pickup vs.
   delivery, and "il Comune di X partecipa" are first-class signals, not
   detail-page footnotes. Maps and presence states are part of the primary
   identity of every product and every store.
3. **Reward is connective tissue.** The loyalty system runs through
   discovery, browsing, and post-purchase, never bolted onto a checkout
   footer. Points and civic incentives are visible while users plan, not
   only when they pay.
4. **km 0 is a state of the UI.** Distance, provenance, and the avoided
   shipping are present without the user asking. Sustainability is shown
   structurally, not claimed in copy.
5. **No SaaS theater, calm under mixed loads.** No gradient heroes, no
   identical card grids, no marketing copy describing itself. Predictable
   rhythm, large hit targets, status by shape and label, motion that honors
   `prefers-reduced-motion`. A 60-year-old shopper and a 30-year-old shop
   employee both read the screen in one pass.

## Accessibility & Inclusion

WCAG 2.2 AA across all three apps. Non-color status signals (icon, label,
text) for any state that matters. `prefers-reduced-motion` collapses all
non-essential animation to fades and instant transitions. Color-blind safe
palette tested for the three common deficiencies. Italian first, English as
secondary; copy avoids idioms that don't translate. Hit targets 44px+ on the
customer app (mobile-first), 36px+ on seller and admin (desktop-primary).
