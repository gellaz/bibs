# StatusBadge unico per le tre app — design

**Date:** 2026-10-18
**Status:** approvato da Marco (scelte fatte sulla preview `/status-badge-preview`, route temporanea)
**Riferimenti:** branch impilato su `fix/admin-config-ritocchi` (`d1caa0f`).

## Problema

Lo stesso stato «attivo» oggi ha cinque vesti: olive tinto (venditori admin), emerald Tailwind
(ordini e promozioni seller), ink pieno (abbonamenti), olive con pallino (team seller), neutro con
pallino (festività). Metà dei badge colorati sta sotto AA in chiaro. Anche i token semantici esistenti
non reggono come testo su fondo tinto (il pattern dei pulsanti soft e dei badge): `success` 2,8:1,
`warning` 2,99:1, `destructive` 4,03:1 in chiaro e 4,02:1 in scuro. In `packages/ui` c'è solo il
primitivo shadcn `Badge`, senza varianti di stato.

## Decisioni

1. **Un componente, `StatusBadge`, in `packages/ui/src/custom/`**, usato nelle tre app. Pillola
   `rounded-full` alta 24 px, fondo tinto al 12% del colore del tono, bordo al 40%, icona 14 px a
   sinistra, testo `text-xs font-medium` nel colore del tono.
2. **L'icona è per stato, non per tono**: pacco = da preparare, camion = spedito, busta = verifica
   email… La sceglie chi chiama.
3. **Cinque toni, decisi da chi guarda, sui token semantici** — mai nomi di colore nei componenti.
   Si usano i token che esistono già; se ne aggiungono due solo dove non c'è un equivalente:

   | Tono | Significato | Token | Colore |
   |---|---|---|---|
   | `action` | tocca a te | `--action` (nuovo) | cobalt |
   | `waiting` | aspetti qualcun altro | `--waiting` (nuovo) | petrolio (nuovo) |
   | `success` | pronto / attivo | `--success` | olive |
   | `closed` | chiuso | `--muted-foreground` + `--border`, senza fondo | warm shadow |
   | `destructive` | fallito | `--destructive` | brick |

   `--warning` resta per i pulsanti («Disattiva»): nessuno stato lo usa.
4. **Stessi colori nelle tre app**, cobalt compreso nel customer: i toni di stato sono stato, non
   registro (come già `warning`). DESIGN.md va emendato (Cross-Register Ban).
5. **Passo n/N solo per l'onboarding venditori**, solo negli stati in corso: badge + «3/6» muted
   accanto, «Passo 3 di 6» per i lettori di schermo.
6. Esclusi: i badge di ruolo (`UserRoleBadge`, `SellerRoleBadge`), che non sono stati.

## Token

I token esistenti cambiano valore per reggere AA come testo su fondo tinto (minimo tra sfondo
pagina e card, tinta 12%). Ne beneficiano anche i pulsanti soft (`variant="success|warning|destructive"`),
che usano lo stesso pattern.

| Token | chiaro | scuro | contrasto chiaro / scuro |
|---|---|---|---|
| `--success` | 0.62 → **`oklch(0.47 0.1 135)`** | invariato `oklch(0.74 0.12 135)` | 5,01 / 5,62 |
| `--destructive` | 0.55 → **`oklch(0.51 0.18 25)`** | 0.66 → **`oklch(0.7 0.15 25)`** | 4,68 / 4,62 |
| `--warning` | 0.62 → **`oklch(0.5 0.12 58)`** | invariato `oklch(0.78 0.14 60)` | 4,75 / 6,05 |
| `--action` (nuovo) | `var(--cobalt-deep)` | `oklch(0.76 0.12 256)` | 6,27 / 5,78 |
| `--waiting` (nuovo) | `var(--petrol)` = `oklch(0.45 0.08 205)` | `oklch(0.8 0.07 200)` | 5,34 / 6,63 |
| chiuso | `--muted-foreground` | `--muted-foreground` | 5,41 / 5,03 |

In palette (DESIGN.md `colors`, primitivi): `olive-deep oklch(0.47 0.1 135)`, `brick-deep oklch(0.51 0.18 25)`,
`petrol oklch(0.45 0.08 205)`; `warning` passa a `oklch(0.5 0.12 58)`. I token semantici puntano a
questi; i componenti usano solo i semantici.

## Mappa degli stati

Il tono dipende da chi guarda: lo stesso stato può cambiare tono tra admin, seller e customer.

**Admin**
- Onboarding (n/6 sugli stati in corso): verifica email `waiting` Mail 1 · anagrafica `waiting`
  UserRound 2 · documento `waiting` IdCard 3 · azienda `waiting` Building2 4 · revisione `action`
  SearchCheck 5 · attivo `success` CircleCheck · rifiutato `destructive` CircleX.
- Abbonamenti: attivo `success` CircleCheck · rinnovo fallito `destructive` CircleAlert · in
  cancellazione **`closed`** CalendarClock · sospeso `destructive` Ban · cancellato `closed` CircleMinus.
- Festività: attiva `success` CircleCheck · disattivata `closed` CircleMinus.
- Utenti: bannato `destructive` Ban.

**Seller**
- Ordini: in attesa di pagamento `waiting` Hourglass · da preparare `action` Package · pronto per il
  ritiro `success` ShoppingBag · spedito `success` Truck · consegnato `closed` PackageCheck ·
  completato `closed` CircleCheck · annullato `destructive` CircleX · scaduto `destructive` TimerOff.
- Promozioni: in corso `success` CirclePlay · pianificata `waiting` CalendarClock · in pausa `closed`
  CirclePause · conclusa `closed` Flag.
- Team: attivo `success` CircleCheck · in attesa `waiting` Hourglass · sospeso `destructive` Ban ·
  rimosso `closed` UserX.
- Abbonamento: attivo `success` CircleCheck · rinnovo fallito `destructive` CircleAlert · in
  cancellazione `waiting` CalendarClock · sospeso `destructive` Ban.
- Fatture: da pagare `action` Receipt · pagata **`success`** CircleCheck · bozza `waiting` FileText ·
  annullata `closed` CircleMinus · non riscossa `destructive` CircleX.
- Pagamenti online: da attivare `action` Plug · da completare `action` ListTodo · in verifica
  `waiting` SearchCheck · attivo `success` CircleCheck.

**Customer**
- Ordini: in attesa di pagamento `action` CreditCard · confermato `waiting` Package · pronto per il
  ritiro `action` ShoppingBag · spedito `waiting` Truck · consegnato `closed` PackageCheck · ritirato
  `closed` CircleCheck · annullato `destructive` CircleX · scaduto `destructive` TimerOff.

Uno stato sconosciuto si mostra col valore grezzo, tono `closed`, icona CircleHelp.

**Contatori delle tab** (`TabNav`): stessi toni. Prodotti seller: attivi `success`, disattivati
`closed`, cestino `destructive`. Venditori admin: in revisione `action`, attivi `success`, rifiutati
`destructive`. Negozi admin: attivi `success`, rinnovo fallito `destructive`, sospesi `destructive`.
Gli altri restano `default`.

## Pulizie collegate

- `OnboardingStatusBadge` ha due stati che il DB non ha più (`pending_store`, `pending_payment`) e usa
  il saffron in admin: si riscrive sulla mappa sopra e le due chiavi Paraglide se ne vanno.
- `TabNav`: via le chiavi Tailwind `amber`/`emerald`/`red`/`cobalt` (nessuno le usa).
- La preview `apps/admin/src/routes/status-badge-preview.tsx` (non committata, nel checkout
  principale) si cancella a fine lavoro.

## Fuori scope (PR successiva)

- Token semantici anche nella home del seller (`apps/seller/src/routes/_authenticated/index.tsx`,
  pallini di urgenza `bg-brick`/`bg-cobalt`/`bg-warm-shadow`) e negli altri ~33 file che usano per
  nome i colori della palette (`saffron`, `cobalt`, `ink`, `warm-*`).
