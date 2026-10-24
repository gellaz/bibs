# Email della candidatura venditore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il venditore riceve un'email quando la candidatura entra in revisione, quando viene approvata e quando viene respinta (con motivo obbligatorio scelto dall'admin); alcuni rifiuti lo rimandano allo step da correggere invece di chiudere la candidatura.

**Architecture:** Una colonna `seller_profiles.rejection_reason`; `rejectSeller` riceve `{ reason, fixStep }` e sposta lo stato su `rejected` / `pending_document` / `pending_company`. Tre template in `@bibs/emails`, inviati da un modulo `onboarding-notifications.ts` che ricalca `billing-notifications.ts` (dopo la scrittura sul DB, non lancia mai). Admin: motivo nella finestra di rifiuto; seller: motivo in cima agli step e nella pagina «rifiutata».

**Tech Stack:** Bun, Elysia + Drizzle (`apps/api`, `bun test`), react-email 6 (`packages/emails`), TanStack Start/Query + paraglide (`apps/admin`, `apps/seller`, Vitest), Base UI via `@bibs/ui`.

**Spec:** `docs/superpowers/specs/2026-10-24-email-candidatura-venditore-design.md`

## Global Constraints

- Branch `feat/email-candidatura-venditore` (già creato da `main`). Mai commit su `main`. Conventional Commits con scope (`api`, `admin`, `seller`, `db`, `onboarding`). Push e `gh pr create` li lancia Marco.
- I motivi della lista sono testo italiano fisso nel codice (vanno identici nell'email); **non** passano da paraglide.
- `SUPPORT_EMAIL = "supporto@bibs.it"`, unica costante condivisa da API (email) e seller (pagina rifiutata).
- Saluto email: `greeting(firstName)` da `packages/emails/src/greeting.ts`, mai `user.name`.
- Le email partono **dopo** il commit della transazione e non lanciano mai (try/catch + `logger.error`), come `apps/api/src/modules/webhooks/services/billing-notifications.ts`.
- Nei test API **non** mockare `@/lib/env` (mock globale, rompe Stripe — vedi memoria): asserire su path (`/onboarding/document`), non sull'URL completo.
- Test API: `cd apps/api && bun run test:integration` / `bun run test:unit`, mai `bun test` nudo. Emails: `cd packages/emails && bun test`. FE: `cd apps/<app> && bun run test <file>`.
- Testi visibili FE in paraglide, chiavi in `messages/it.json` **e** `en.json`.
- Toast solo da `@bibs/ui/components/sonner`.

## Review Focus

1. **Motivo vuoto o fatto di soli spazi** (admin che forza la richiesta): 422, nulla cambia. → test in Task 1.
2. **Invio email che fallisce** (Resend giù, profilo sparito): la moderazione riesce comunque e risponde 200. → test in Task 4.
3. **Doppio clic / tab vecchia su «Rifiuta»**: secondo tentativo 409, una sola email. → test in Task 4.
4. **Venditore che dopo il rifiuto «documento» torna indietro allo step anagrafica e poi riavanza**: arriva in revisione senza rifare i dati aziendali. → test in Task 2.
5. **HTML nel motivo scritto a mano** (`<a href=…>`): esce escapato nell'email. → test in Task 3.

---

### Task 1: Motivo del rifiuto nel DB e nella moderazione (API)

**Files:**
- Create: `apps/api/src/lib/schemas/forms/seller-rejection.ts`
- Modify: `apps/api/src/lib/schemas/forms/index.ts` (export)
- Modify: `apps/api/src/db/schemas/seller.ts` (colonna `rejectionReason: text("rejection_reason")`, nullable, dopo `vatChangeBlocked`)
- Create: migrazione da `bun run db:generate`
- Modify: `apps/api/src/lib/schemas/entities.ts:197-246` (`SellerProfileSchema`: `rejectionReason: t.Nullable(t.String({ description: "Motivo dell'ultimo rifiuto, azzerato all'approvazione" }))`)
- Modify: `apps/api/src/modules/admin/services/sellers.ts:182-232` (`decideReview`, `verifySeller`, `rejectSeller`)
- Modify: `apps/api/src/modules/admin/routes/sellers.ts:113-142` (body + log + descrizione)
- Test: `apps/api/tests/integration/admin-sellers.test.ts`, `apps/api/tests/unit/seller-rejection-schema.test.ts`

**Interfaces:**
- Produces (`seller-rejection.ts`, esportati da `@bibs/api/schemas`):
  - `SELLER_REJECTION_FIX_STEPS = ["document", "company"] as const`; `type SellerRejectionFixStep`
  - `SELLER_REJECTION_REASONS: readonly { label: string; fixStep: SellerRejectionFixStep | null }[]` con, in ordine: `"Documento illeggibile"`/document, `"Documento scaduto o non valido"`/document, `"Dati del documento diversi dalla foto"`/document, `"P.IVA non valida o diversa dalla ragione sociale"`/company, `"Attività non ammessa su bibs"`/null, `"Identità non verificabile"`/null
  - `SUPPORT_EMAIL = "supporto@bibs.it"`
  - `RejectSellerBody = Type.Object({ reason: Type.String({ minLength: 1, maxLength: 500, pattern: "\\S", description: "Motivo del rifiuto, mostrato al venditore e nell'email", error: "Indica il motivo del rifiuto" }), fixStep: Type.Union([Type.Literal("document"), Type.Literal("company"), Type.Null()], { description: "Step da correggere; null = rifiuto definitivo" }) })` — literal espliciti, niente `.map()` (Eden → `never`).
- Produces (service): `rejectSeller(sellerId: string, rejection: Static<typeof RejectSellerBody>)`, `verifySeller(sellerId: string)` invariata nella firma.

- [ ] **Step 1: Test di schema (unit)**

```ts
// apps/api/tests/unit/seller-rejection-schema.test.ts
import { Value } from "@sinclair/typebox/value";
it("rifiuta motivo vuoto o di soli spazi", () => {
  expect(Value.Check(RejectSellerBody, { reason: "", fixStep: null })).toBe(false);
  expect(Value.Check(RejectSellerBody, { reason: "   ", fixStep: null })).toBe(false);
  expect(Value.Check(RejectSellerBody, { reason: "x".repeat(501), fixStep: null })).toBe(false);
});
it("accetta motivo + fixStep validi", () => {
  expect(Value.Check(RejectSellerBody, { reason: "Documento illeggibile", fixStep: "document" })).toBe(true);
  expect(Value.Check(RejectSellerBody, { reason: "Altro", fixStep: "shipping" })).toBe(false);
});
```

- [ ] **Step 2: Test di integrazione (aggiorna `describe("rejectSeller")` e `describe("verifySeller")`)**

Le chiamate esistenti diventano `rejectSeller(id, { reason: "Attività non ammessa su bibs", fixStep: null })`; la tabella dei 409 passa `(id) => rejectSeller(id, DEFINITIVE)` a `expectConflictUnchanged`. Nuovi casi:
- `fixStep: null` → `onboardingStatus === "rejected"`, `vatStatus === "rejected"`, `rejectionReason === "Attività non ammessa su bibs"`.
- `fixStep: "document"` → `onboardingStatus === "pending_document"`, organizzazione ancora presente con `vatStatus === "pending"`, `rejectionReason` salvato.
- `fixStep: "company"` → `onboardingStatus === "pending_company"`, nessuna riga `organization` per quel profilo.
- motivo con spazi ai lati → salvato `trim()`-ato.
- `verifySeller` su un profilo `pending_review` con `rejectionReason` valorizzato → `rejectionReason === null`.

- [ ] **Step 3: Esegui, verifica che falliscano**

Run: `cd apps/api && bun run test:unit && bun run test:integration`
Expected: FAIL (export mancante, firma `rejectSeller`, colonna assente).

- [ ] **Step 4: Implementa**

- Colonna + `bun run db:generate`; **leggi l'SQL** (deve essere solo `ALTER TABLE "seller_profiles" ADD COLUMN "rejection_reason" text;`), poi `bun run db:migrate`.
- `decideReview(sellerId, outcome)` con `outcome: { onboardingStatus: Extract<OnboardingStatus, "active" | "rejected" | "pending_document" | "pending_company">; rejectionReason: string | null; organization: { vatStatus: Extract<VatStatus, "verified" | "rejected"> } | "keep" | "delete" }`. La CAS su `pending_review` resta identica; `rejectionReason` va nello stesso `UPDATE` del profilo; `"delete"` cancella la riga `organization` (come fa `goBack` da `pending_review`).
- Mappa: verify → `active` / `null` / `{ vatStatus: "verified" }`; reject `null` → `rejected` / motivo / `{ vatStatus: "rejected" }`; `document` → `pending_document` / motivo / `"keep"`; `company` → `pending_company` / motivo / `"delete"`.
- Route: `body: RejectSellerBody`; log con `reason` e `fixStep`; `description`: «Respinge la candidatura con un motivo obbligatorio, mostrato al venditore e inviato per email. `fixStep` null = rifiuto definitivo (rejected); `document` / `company` = il venditore torna a quello step per correggere e reinviare. Solo da pending_review: 409 se la candidatura è già stata decisa.»

- [ ] **Step 5: Esegui, verifica che passino**

Run: `cd apps/api && bun run test:unit && bun run test:integration && bun run typecheck`
Expected: PASS. Da root `bun run typecheck` rosso **solo** in `apps/admin` (chiamata `reject.patch()` senza body) — si sistema nel Task 5.

- [ ] **Step 6: Commit**

```bash
git add apps/api docs/superpowers
git commit -m "feat(api): motivo obbligatorio e rifiuto correggibile nella moderazione venditori"
```

---

### Task 2: Reinvio dopo un rifiuto «documento» (API)

**Files:**
- Modify: `apps/api/src/modules/seller/services/onboarding.ts:105-142` (`updateDocument`)
- Test: `apps/api/tests/integration/seller-onboarding-document.test.ts`

**Interfaces:**
- Consumes: niente dai task precedenti oltre allo stato `pending_document` con organizzazione già presente (prodotto da `rejectSeller(…, { fixStep: "document" })`).
- Produces: `updateDocument` porta a `pending_review` quando il profilo ha già un'organizzazione, altrimenti a `pending_company` come oggi.

- [ ] **Step 1: Test**

```ts
it("con l'organizzazione già salvata (rifiuto 'document') va dritto in revisione", async () => {
  const { userId, municipalityId, profileId } = await sellerAtDocumentStep();
  await createTestOrganization(getTestDb(), profileId);
  await updateDocument({ userId, ...validDocument(municipalityId), documentImage: image() });
  expect(await statusOf(userId)).toBe("pending_review");
});
```
(`sellerAtDocumentStep` restituisce anche `profileId: seller.profile.id`; `validDocument` = i campi già usati dai test esistenti del file.) Il caso esistente senza organizzazione resta `pending_company`.

- [ ] **Step 2: Esegui, verifica che fallisca** — `cd apps/api && bun run test:integration` → FAIL (`pending_company`).

- [ ] **Step 3: Implementa** — prima dell'update leggi `organization` per `sellerProfileId` (solo `id`) e scegli lo stato successivo.

- [ ] **Step 4: Esegui, verifica che passi** — stesso comando → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(onboarding): dopo un rifiuto sul documento il reinvio torna in revisione"
```

---

### Task 3: Tre template email (`@bibs/emails`)

**Files:**
- Create: `packages/emails/emails/seller-application-received-email.tsx`, `seller-approved-email.tsx`, `seller-rejected-email.tsx`
- Modify: `packages/emails/src/index.tsx` (tre `render*` + export dei tipi props)
- Test: `packages/emails/tests/seller-onboarding-emails.test.tsx`

**Interfaces:**
- Produces:
  - `renderSellerApplicationReceivedEmail(props: { firstName: string | null }): Promise<RenderedEmail>` — subject `"Abbiamo ricevuto la tua candidatura su bibs"`
  - `renderSellerApprovedEmail(props: { firstName: string | null; sellerUrl: string }): Promise<RenderedEmail>` — subject `"Il tuo account venditore su bibs è attivo"`
  - `renderSellerRejectedEmail(props: { firstName: string | null; reason: string; fix: { step: "document" | "company"; url: string } | null; supportEmail: string }): Promise<RenderedEmail>` — subject `"La tua candidatura su bibs va corretta"` se `fix`, altrimenti `"La tua candidatura su bibs non è stata approvata"`

Testi (stesso stile di `store-suspended-email.tsx`: `Html`/`Body lang="it"`, `Text`, `Link` con l'URL in chiaro, `PreviewProps`):
- **Ricevuta:** `greeting(firstName)` · «abbiamo ricevuto la tua candidatura come venditore su bibs: adesso controlliamo i tuoi dati e il documento d'identità.» · «Ti scriviamo appena l'abbiamo valutata, non devi fare altro.»
- **Approvata:** saluto · «la tua candidatura è stata approvata: da adesso puoi vendere su bibs.» · «Entra e crea il tuo primo negozio:» · link `sellerUrl`.
- **Respinta:** saluto · con `fix` «abbiamo controllato la tua candidatura e c'è qualcosa da correggere.», senza «abbiamo controllato la tua candidatura e purtroppo non possiamo approvarla.» · «Motivo: **{reason}**» · se `fix.step === "document"` «Carica di nuovo il documento d'identità: gli altri dati restano salvati.»; se `"company"` «Inserisci di nuovo i dati aziendali.»; poi «Correggi e reinvia da qui:» + link `fix.url` · sempre «Per qualsiasi domanda scrivici a {supportEmail}.» con `Link href={"mailto:" + supportEmail}`.

- [ ] **Step 1: Test** (stessa `normalize` di `billing-emails.test.tsx`)
  - ricevuta: subject esatto; contiene `"Ciao Mario,"`; con `firstName: null` contiene `"Ciao,"`.
  - approvata: subject esatto; `href="https://seller.example.test/"`.
  - respinta definitiva: subject «non è stata approvata»; contiene il motivo e `href="mailto:supporto@bibs.it"`; **non** contiene «Correggi e reinvia».
  - respinta `document`: subject «va corretta»; contiene «Carica di nuovo il documento» e `href="https://seller.example.test/onboarding/document"`.
  - escape: `reason: '<a href="https://x.test">clicca</a>'` → l'HTML non contiene `<a href="https://x.test">`.

- [ ] **Step 2: Esegui, verifica che fallisca** — `cd packages/emails && bun test` → FAIL (export mancanti).

- [ ] **Step 3: Implementa** i tre template e le tre `render*`.

- [ ] **Step 4: Esegui, verifica che passi** — `cd packages/emails && bun test && bun run typecheck` → PASS. Controllo a occhio: `bun run dev:emails` (preview su :3004).

- [ ] **Step 5: Commit**

```bash
git add packages/emails
git commit -m "feat(onboarding): template email candidatura ricevuta, approvata e respinta"
```

---

### Task 4: Invio delle email (API)

**Files:**
- Create: `apps/api/src/modules/seller/services/onboarding-notifications.ts`
- Modify: `apps/api/src/modules/seller/services/onboarding.ts` (`updateCompany` dopo la transazione; `updateDocument` quando va in `pending_review`)
- Modify: `apps/api/src/modules/admin/services/sellers.ts` (`verifySeller`, `rejectSeller` dopo `decideReview`)
- Test: `apps/api/tests/integration/admin-sellers.test.ts`, `apps/api/tests/integration/seller-onboarding-document.test.ts`

**Interfaces:**
- Consumes: `render*` del Task 3; `SUPPORT_EMAIL`, `SellerRejectionFixStep` del Task 1; `sendEmail` da `@/lib/email`; `env.SELLER_APP_URL`.
- Produces:
  - `notifyApplicationReceived(sellerProfileId: string): Promise<void>`
  - `notifySellerApproved(sellerProfileId: string): Promise<void>` — `sellerUrl = SELLER_APP_URL + "/"`
  - `notifySellerRejected(params: { sellerProfileId: string; reason: string; fixStep: SellerRejectionFixStep | null }): Promise<void>` — `fix.url` = `SELLER_APP_URL + "/onboarding/document"` o `"/onboarding/company"`
  - Tutte non lanciano mai: helper interno `notifySeller(kind, sellerProfileId, render)` come `notifyOwner`, che carica `sellerProfile.firstName` + `user.email`.

- [ ] **Step 1: Test** — in entrambi i file `const sendEmail = mock(async (_: { to: string; subject: string; html: string }) => {}); mock.module("@/lib/email", () => ({ sendEmail }));` prima degli import, `sendEmail.mockReset()` + `mockImplementation(async () => {})` nel `beforeEach`.
  - `verifySeller` → una chiamata, `to` = email del seller, subject «Il tuo account venditore su bibs è attivo».
  - `rejectSeller(…, { reason: "Documento illeggibile", fixStep: "document" })` → una chiamata; `html` contiene «Documento illeggibile» e `/onboarding/document`.
  - doppio `rejectSeller` sullo stesso profilo → il secondo 409, `sendEmail` chiamato **una** volta.
  - `sendEmail.mockImplementation(async () => { throw new Error("resend down") })` → `rejectSeller` risolve comunque e lo stato è cambiato.
  - `updateDocument` con organizzazione presente → una email «Abbiamo ricevuto la tua candidatura su bibs»; senza organizzazione → nessuna.
  - `updateCompany` (nuovo `describe` nello stesso file: profilo `pending_company`, comune di test) → stato `pending_review` e una email «Abbiamo ricevuto…».

- [ ] **Step 2: Esegui, verifica che falliscano** — `cd apps/api && bun run test:integration` → FAIL (nessuna chiamata).

- [ ] **Step 3: Implementa** il modulo e le quattro chiamate (`await`, dopo la transazione / dopo `decideReview`).

- [ ] **Step 4: Esegui, verifica che passino** — `cd apps/api && bun run test && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(onboarding): email al venditore su revisione, approvazione e rifiuto"
```

---

### Task 5: Motivo nella finestra di rifiuto (admin)

**Files:**
- Modify: `apps/admin/src/components/seller-moderation-dialog.tsx`
- Modify: `apps/admin/src/routes/_authenticated/sellers/$sellerId.tsx` (passa il motivo a `confirm`; mostra `rejectionReason`)
- Modify: `apps/admin/src/routes/_authenticated/sellers/index.tsx` (stessa firma di `onConfirm`)
- Modify: `apps/admin/messages/it.json`, `en.json`
- Test: `apps/admin/src/components/seller-moderation-dialog.test.ts`

**Interfaces:**
- Consumes: `SELLER_REJECTION_REASONS`, `RejectSellerBody` da `@bibs/api/schemas`; `rejectionReason` su `SellerProfileSchema` (Task 1).
- Produces:
  - `rejectionFromForm(choice: number | "other" | null, otherText: string, otherFixStep: SellerRejectionFixStep | null): Static<typeof RejectSellerBody> | null` — `choice` = indice in `SELLER_REJECTION_REASONS`; `"other"` usa `otherText.trim()` (null se vuoto) e `otherFixStep`; `null` → `null`.
  - `useSellerModeration().confirm(rejection?: Static<typeof RejectSellerBody>)`; `rejectMutation` manda `reject.patch(rejection)`.
  - `SellerModerationDialog` prop `onConfirm: (rejection?: Static<typeof RejectSellerBody>) => void`.

UI (solo per `type === "reject"`, dentro l'`AlertDialogContent` esistente, `key={target?.sellerId}` per azzerare i campi):
- `NativeSelect` «Motivo» (come in `apps/seller/.../onboarding/document.tsx`) con le voci della lista + «Altro…»; sotto, `FieldDescription` con l'esito della voce scelta: «Il venditore potrà ricaricare il documento» / «Il venditore potrà correggere i dati aziendali» / «Rifiuto definitivo».
- Con «Altro…»: `Textarea` (max 500) + `RadioGroup` «Cosa può fare il venditore»: «Niente, rifiuto definitivo» (default) / «Ricaricare il documento» / «Correggere i dati aziendali».
- «Rifiuta» disabilitato finché `rejectionFromForm(...)` è `null`.
- Dettaglio venditore: se `seller.rejectionReason`, un `Alert` sopra il corpo a due colonne: «Motivo del rifiuto: {reason}» (con `pending_review` diventa «Respinta in precedenza: {reason}»).

- [ ] **Step 1: Test** di `rejectionFromForm`: `(0, "", null)` → `{ reason: "Documento illeggibile", fixStep: "document" }`; `(4, "", null)` → `fixStep: null`; `("other", "   ", null)` → `null`; `("other", " Foto di un'altra persona ", "document")` → `{ reason: "Foto di un'altra persona", fixStep: "document" }`; `(null, "x", null)` → `null`.

- [ ] **Step 2: Esegui, verifica che fallisca** — `cd apps/admin && bun run test src/components/seller-moderation-dialog.test.ts` → FAIL.

- [ ] **Step 3: Implementa** funzione, dialog, hook, i due chiamanti, messaggi it/en.

- [ ] **Step 4: Esegui** — stesso test → PASS; da root `bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): motivo del rifiuto venditore, da lista o scritto a mano"
```

---

### Task 6: Motivo nell'onboarding del venditore (seller)

**Files:**
- Modify: `apps/seller/src/features/onboarding/components/onboarding-layout.tsx` (banner)
- Modify: `apps/seller/src/routes/_authenticated/onboarding/pending.tsx` (motivo + supporto)
- Modify: `apps/seller/src/routes/_authenticated/onboarding/document.tsx:120-122` (navigazione dopo l'invio)
- Modify: `apps/seller/messages/it.json`, `en.json`

**Interfaces:**
- Consumes: `rejectionReason` dalla risposta di `useOnboardingStatus()` e delle mutation (Task 1); `SUPPORT_EMAIL` da `@bibs/api/schemas`; `updateDocument` che può restituire `pending_review` (Task 2).

- `OnboardingLayout`: legge `useOnboardingStatus()`; se `rejectionReason` c'è, `Alert variant="destructive"` tra stepper e card, titolo `m.onboarding_rejected_fix_title()` («Candidatura da correggere»), descrizione = il motivo.
- `pending.tsx` con `rejected`: descrizione = `rejectionReason` se presente, altrimenti il testo generico attuale (`onboarding_pending_rejected_body`, profili rifiutati prima di questa PR: mai «null» a schermo); sotto, «Per domande scrivi a» + link `mailto:` a `SUPPORT_EMAIL`.
- `document.tsx`: dopo `mutateAsync`, naviga a `/onboarding/pending` se il profilo restituito è `pending_review`, altrimenti `/onboarding/company`.

- [ ] **Step 1: Implementa** le tre modifiche e i messaggi it/en.
- [ ] **Step 2: Verifica** — `cd apps/seller && bun run test && bun run typecheck` → PASS.
- [ ] **Step 3: Commit**

```bash
git add apps/seller
git commit -m "feat(seller): motivo del rifiuto negli step di onboarding e nella pagina rifiutata"
```

---

### Task 7: Verifica completa e smoke

- [ ] **Step 1:** da root `bun run typecheck && bun run lint && bun run test` → tutto verde (controlla l'esito per workspace, l'aggregato `--filter` può nascondere fallimenti).
- [ ] **Step 2:** `/openapi`: `PATCH /admin/sellers/{sellerId}/reject` mostra il body `reason` + `fixStep`.
- [ ] **Step 3: Smoke** (Chrome DevTools MCP, contesto isolato, **solo venditori di prova creati per lo smoke**, mai profili del seed; Mailpit su :8025):
  1. Registra un venditore di prova e completa l'onboarding → email «Abbiamo ricevuto…».
  2. Admin (:3003) → Rifiuta con «Documento illeggibile» → email «va corretta» con link; il seller (:3002) atterra sul documento col banner; ricarica → pagina «in revisione» + nuova email «ricevuta»; admin vede «Respinta in precedenza».
  3. Admin → Rifiuta con «Altro…» + testo + «Niente, rifiuto definitivo» → email «non è stata approvata» con mailto; pagina «rifiutata» col motivo.
  4. Secondo venditore di prova → Approva → email «attivo»; nel dettaglio admin nessun motivo.
- [ ] **Step 4:** Marco prova a mano finestra admin e pagine seller (mouse e tastiera) prima della PR.
