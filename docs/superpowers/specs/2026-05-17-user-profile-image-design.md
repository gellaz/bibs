# Immagine profilo utente (seller / admin / customer)

**Data**: 2026-05-17
**Scope**: `apps/api` (nuovo modulo `me`), `apps/seller`, `apps/customer`, `apps/admin`, `packages/ui` (componente condiviso + dialog di upload)
**Out of scope**: admin che modifica l'avatar di un altro utente; cleanup automatico dell'oggetto S3 alla cancellazione dell'utente (vale per tutte le immagini del progetto, da gestire in un job futuro); avatar dello store/organizzazione (esiste già il pattern dedicato in `store-images`); multi-size / thumbnail server-side; drag-and-drop nel dialog (file picker è sufficiente); E2E test frontend.

## Obiettivo

Permettere a ogni utente autenticato — qualunque sia il ruolo (seller, admin, customer, employee) — di **caricare facoltativamente** un'immagine del profilo che venga poi mostrata nei propri avatar (NavUser, HeaderUser, pagina profilo, eventuali listing futuri).

L'utente accede alla funzione dalla propria pagina `/profile`: clicca sull'avatar grande in cima alla "Personal Info Card" e si apre un dialog in cui sceglie un file, lo ritaglia in forma circolare 1:1 con uno strumento di pan + zoom, e conferma. L'immagine viene processata, salvata su S3 e l'avatar in tutta l'app si aggiorna senza reload. L'utente può anche rimuovere l'immagine in qualsiasi momento, tornando alle iniziali del nome.

## Decisioni chiave (negoziate in brainstorming)

| Tema | Decisione |
|---|---|
| Schema DB | Nessun cambiamento. Si riusa la colonna esistente `user.image text` (nullable) di Better Auth, già consumata da `UserAvatar` in tutte e 3 le app. |
| UX upload | Avatar grande cliccabile nella pagina profilo → dialog con `react-easy-crop` (cropShape circolare, aspect 1, pan + zoom). |
| Punti d'accesso | Solo `/profile`. Niente voce nel NavUser/HeaderUser. |
| Endpoint API | Custom Elysia in nuovo modulo `me`: `POST /me/avatar` (multipart) + `DELETE /me/avatar`. Aggiorna `user.image` direttamente via Drizzle, **non** via `authClient.updateUser`. |
| Limiti file in input | `t.File({ type: "image", maxSize: "5m" })` — coerente con products/store images. |
| Pipeline server-side | `sharp` per resize-cover 512×512 JPEG quality 85. Crop dal client + sharp lato server (rete di sicurezza per payload malevoli). |
| Storage S3 | Key pattern `users/{userId}/{uuid}.jpg`. UUID nuovo a ogni upload → nessuna collisione cache HTTP. Best-effort cleanup del file precedente dopo update DB riuscito. |
| Crop lib client | `react-easy-crop` (~15kb, MIT, API semplice). |
| Errori | Validazione client (mime/size) prima della call → `toast.error` (sonner) istantaneo. Errori API → `toast.error`, dialog resta aperto per ritentare. |
| Posizionamento UI | Avatar inline in **PersonalInfoCard** estratto come componente condiviso in `@bibs/ui` (oggi duplicato 3 volte in seller/customer/admin). |
| Rimozione | Bottone "Rimuovi immagine" nel dialog (visibile solo se `currentImage` è presente) → `DELETE /me/avatar` → setta `user.image = null` e cancella l'oggetto S3. |
| Aggiornamento UI dopo upload | `authClient.useSession().refetch()` dopo la mutation per propagare `user.image` ai consumer reattivi (NavUser, HeaderUser, profile avatar). Fallback su `authClient.getSession({ query: { disableCookieCache: true }})` se `refetch` non esposto. |
| i18n del componente | `@bibs/ui` resta agnostico da Paraglide: il dialog accetta i testi come prop `labels`. Ciascuna app passa stringhe da `messages/it.json`. |
| Permessi | Tutti gli utenti autenticati. Nessuna restrizione per ruolo. Admin **non** può modificare avatar altrui in questo scope. |

---

## Architettura — Backend

### Nuovo modulo: `apps/api/src/modules/me/`

Parallelo a `seller/`, `customer/`, `admin/`. Motivo: l'endpoint vale per **tutti** gli utenti autenticati indipendentemente dal ruolo.

```
apps/api/src/modules/me/
├── index.ts              # plugin Elysia che monta avatarRoutes
├── routes/
│   └── avatar.ts         # POST /me/avatar, DELETE /me/avatar
└── services/
    └── avatar.ts         # uploadUserAvatar, deleteUserAvatar
```

Montaggio in `apps/api/src/index.ts`: `app.use(meRoutes)` accanto a sellerRoutes / customerRoutes / adminRoutes.

### Routes

```ts
// apps/api/src/modules/me/routes/avatar.ts
import { Elysia, t } from "elysia";
import { betterAuth } from "@/plugins/better-auth";
import { okMessage } from "@/lib/responses";
import { OkMessage, okRes, withErrors } from "@/lib/schemas";
import { getLogger } from "@/lib/logger";
import { deleteUserAvatar, uploadUserAvatar } from "../services/avatar";

const AvatarResponse = t.Object({
  image: t.String({ description: "URL pubblica della nuova immagine profilo" }),
});

export const avatarRoutes = new Elysia({ prefix: "/me" })
  .use(betterAuth)
  .post(
    "/avatar",
    async ({ user, body, store }) => {
      const pino = getLogger(store);
      const result = await uploadUserAvatar({ userId: user.id, file: body.file });
      pino.info(
        { userId: user.id, action: "user_avatar_uploaded", key: result.key },
        "Immagine profilo aggiornata",
      );
      return { image: result.url };
    },
    {
      auth: true,
      body: t.Object({
        file: t.File({
          type: "image",
          maxSize: "5m",
          description: "Immagine (max 5MB, formati image/*)",
        }),
      }),
      response: withErrors({ 200: okRes(AvatarResponse) }),
      detail: {
        summary: "Carica immagine profilo",
        description:
          "Carica un'immagine per l'utente corrente. Il file viene ridimensionato a 512x512 JPEG e salvato su S3. La URL viene scritta su `user.image`.",
        tags: ["Me"],
      },
    },
  )
  .delete(
    "/avatar",
    async ({ user, store }) => {
      const pino = getLogger(store);
      await deleteUserAvatar({ userId: user.id });
      pino.info(
        { userId: user.id, action: "user_avatar_deleted" },
        "Immagine profilo rimossa",
      );
      return okMessage("Avatar removed");
    },
    {
      auth: true,
      response: withErrors({ 200: OkMessage }),
      detail: {
        summary: "Rimuovi immagine profilo",
        description:
          "Setta `user.image` a NULL e cancella il file da S3 (best-effort). No-op se l'utente non ha un'immagine.",
        tags: ["Me"],
      },
    },
  );
```

### Service `uploadUserAvatar`

```ts
// apps/api/src/modules/me/services/avatar.ts
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user as userTable } from "@/db/schemas/auth";
import { ServiceError } from "@/lib/errors";
import { publicUrl, s3 } from "@/lib/s3";
import { env } from "@/lib/env";

interface UploadUserAvatarParams {
  userId: string;
  file: File;
}

export async function uploadUserAvatar({ userId, file }: UploadUserAvatarParams) {
  // 1. Recupera l'immagine corrente (per cleanup successivo)
  const current = await db.query.user.findFirst({
    where: eq(userTable.id, userId),
    columns: { image: true },
  });

  // 2. Normalizza l'immagine lato server (rete di sicurezza)
  const buffer = Buffer.from(await file.arrayBuffer());
  let processed: Buffer;
  try {
    processed = await sharp(buffer)
      .resize(512, 512, { fit: "cover", position: "centre" })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw new ServiceError(400, "Immagine non valida o corrotta");
  }

  // 3. Upload su S3 con nuovo UUID (cache busting + niente collisioni)
  const key = `users/${userId}/${crypto.randomUUID()}.jpg`;
  const url = publicUrl(key);
  await s3.write(key, processed, { type: "image/jpeg" });

  // 4. Aggiorna user.image; rollback S3 se fallisce
  try {
    await db.update(userTable).set({ image: url }).where(eq(userTable.id, userId));
  } catch (err) {
    await s3.delete(key).catch(() => {});
    throw err;
  }

  // 5. Cleanup best-effort del file precedente (non blocca la response)
  if (current?.image) {
    const oldKey = extractOurKey(current.image);
    if (oldKey) {
      s3.delete(oldKey).catch(() => {
        // log con action "avatar_old_cleanup_failed"
      });
    }
  }

  return { key, url };
}

interface DeleteUserAvatarParams {
  userId: string;
}

export async function deleteUserAvatar({ userId }: DeleteUserAvatarParams) {
  const current = await db.query.user.findFirst({
    where: eq(userTable.id, userId),
    columns: { image: true },
  });
  if (!current?.image) return; // no-op

  await db.update(userTable).set({ image: null }).where(eq(userTable.id, userId));

  const oldKey = extractOurKey(current.image);
  if (oldKey) {
    await s3.delete(oldKey).catch(() => {});
  }
}

/**
 * Restituisce la S3 key se la URL appartiene al nostro bucket (prefisso `users/`),
 * altrimenti null (es. URL legacy o da provider esterno OAuth).
 */
function extractOurKey(imageUrl: string): string | null {
  const expectedPrefix = `${env.S3_ENDPOINT}/${env.S3_BUCKET}/`;
  if (!imageUrl.startsWith(expectedPrefix)) return null;
  const key = imageUrl.slice(expectedPrefix.length);
  return key.startsWith("users/") ? key : null;
}
```

### Dipendenze nuove API

- `sharp` (catalog → workspace `apps/api`). Necessario per la pipeline server-side. Già non presente.

---

## Architettura — Frontend

### Nuovo componente: `packages/ui/src/components/avatar-upload-dialog.tsx`

API:

```ts
interface AvatarUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentImage?: string | null;
  name?: string | null;                       // per fallback iniziali nel preview
  onUpload: (file: File) => Promise<void>;
  onRemove?: () => Promise<void>;             // se omessa, niente bottone "Rimuovi"
  labels: {
    title: string;                            // es. "Cambia immagine profilo"
    chooseFile: string;
    cropHelp: string;                         // es. "Trascina per spostare, slider per ingrandire"
    save: string;
    cancel: string;
    back: string;
    remove: string;
    errorInvalidType: string;
    errorTooLarge: string;
    errorGeneric: string;
  };
}
```

Stati interni:
- `selectedFile: File | null` — l'originale scelto dal picker.
- `imageSrc: string | null` — `URL.createObjectURL(file)`.
- `crop`, `zoom`, `croppedAreaPixels` — di `react-easy-crop`.
- `isSaving`, `isRemoving`.

Flusso:

```
┌─ Stato A (no file selezionato) ────────┐
│ Preview Avatar (currentImage o init.)  │
│ [Scegli file] [Rimuovi*] [Annulla]     │
└──────┬─────────────────────────────────┘
       │ file selezionato (validato)
       ▼
┌─ Stato B (crop) ───────────────────────┐
│ <Cropper> 1:1 circular                 │
│ Slider zoom 1×–3×                      │
│ [Indietro]                  [Salva]    │
└────────────────────────────────────────┘
```

Validazione client (prima di passare A → B):
- `file.type` ∈ `["image/png", "image/jpeg", "image/webp"]` — altrimenti `toast.error(labels.errorInvalidType)`.
- `file.size <= 5 * 1024 * 1024` — altrimenti `toast.error(labels.errorTooLarge)`.

Su "Salva":
1. `cropImageToBlob(imageSrc, croppedAreaPixels)` → `Blob` JPEG 512×512 qualità 0.9.
2. `new File([blob], "avatar.jpg", { type: "image/jpeg" })`.
3. `await onUpload(file)`.
4. Su successo: `onOpenChange(false)`.
5. Su errore: `toast.error(labels.errorGeneric)`, dialog resta aperto.

### Nuova util: `packages/ui/src/lib/crop-image.ts`

Funzione `cropImageToBlob(imageSrc: string, area: { x; y; width; height }): Promise<Blob>`:
1. Carica un `<img>` da `imageSrc` (Promise wrap di `onload`/`onerror`).
2. Crea `<canvas width=512 height=512>`.
3. `ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, 512, 512)`.
4. `canvas.toBlob(resolve, "image/jpeg", 0.9)`.

### PersonalInfoCard condiviso

**Decisione di refactor**: l'attuale `PersonalInfoCard` esiste in 3 forme quasi identiche:
- `apps/seller/src/features/profile/components/personal-info-card.tsx` (in una `<Card>`).
- `apps/customer/src/routes/_authenticated/profile.tsx` (in `<Card className="w-full max-w-md">`).
- `apps/admin/src/routes/_authenticated/profile.tsx` (in `<Card className="max-w-md">`).

Si estrae in `packages/ui/src/components/personal-info-card.tsx`. API:

```ts
interface PersonalInfoCardProps {
  // Dati & callback
  initialValues: { firstName?: string | null; lastName?: string | null; birthDate?: string | null; image?: string | null; name?: string | null };
  onSubmit: (data: { firstName: string; lastName: string; birthDate?: string }) => Promise<{ error?: string }>;
  onUploadAvatar: (file: File) => Promise<void>;
  onRemoveAvatar: () => Promise<void>;
  // i18n: stringhe della card + del dialog
  labels: PersonalInfoCardLabels;       // include AvatarUploadDialog labels nested
  // Variant (per il customer che ha un layout centrato in min-h-screen)
  className?: string;
}
```

Le 3 pagine `/profile` diventano wrapper sottili che leggono session da `authClient`, costruiscono i callback (con Eden Treaty + Better Auth) e passano i `labels` Paraglide.

### Integrazione nelle 3 app

Pattern identico per seller/customer/admin (codice nel rispettivo wrapper):

```tsx
const { data: session, refetch } = authClient.useSession();

const onSubmit = async (data) => {
  const { error } = await authClient.updateUser({
    firstName: data.firstName,
    lastName: data.lastName,
    birthDate: data.birthDate || undefined,
    name: `${data.firstName} ${data.lastName}`,
  });
  return { error: error?.message };
};

const onUploadAvatar = async (file: File) => {
  const res = await api.me.avatar.post({ file });
  if (res.error) throw new Error(typeof res.error.value === "string" ? res.error.value : "Errore");
  await refetch();
  toast.success(m.profile_avatar_updated());
};

const onRemoveAvatar = async () => {
  const res = await api.me.avatar.delete();
  if (res.error) throw new Error(typeof res.error.value === "string" ? res.error.value : "Errore");
  await refetch();
  toast.success(m.profile_avatar_removed());
};
```

### Aggiornamento avatar in NavUser / HeaderUser

Nessuna modifica al codice. Tutti consumano già `session.user.image` reattivo via `authClient.useSession()`. Appena `refetch()` aggiorna lo store di Better Auth, l'icona in sidebar/header si aggiorna.

### Dipendenze nuove frontend

- `react-easy-crop` (catalog → workspace `packages/ui`).

---

## i18n — chiavi nuove per Paraglide

In `messages/it.json` di ciascuna app (seller / customer / admin):

```
profile_avatar_section_title = "Immagine profilo"
profile_avatar_dialog_title = "Cambia immagine profilo"
profile_avatar_choose_file = "Scegli file"
profile_avatar_remove = "Rimuovi immagine"
profile_avatar_save = "Salva"
profile_avatar_cancel = "Annulla"
profile_avatar_back = "Indietro"
profile_avatar_crop_help = "Trascina per spostare, usa lo slider per ingrandire"
profile_avatar_updated = "Immagine profilo aggiornata"
profile_avatar_removed = "Immagine profilo rimossa"
profile_avatar_error_invalid_type = "Formato non supportato. Usa PNG, JPEG o WebP."
profile_avatar_error_too_large = "File troppo grande. Massimo 5MB."
profile_avatar_error_generic = "Errore durante il caricamento. Riprova."
```

---

## Gestione errori end-to-end

| Punto | Errore | Trattamento |
|---|---|---|
| Client validation | mime non valido | `toast.error(profile_avatar_error_invalid_type)`, nessuna call |
| Client validation | file > 5MB | `toast.error(profile_avatar_error_too_large)`, nessuna call |
| API Elysia | `t.File` constraint failed | 400 dal framework → toast generico client |
| API Elysia | macro `auth` fallisce | 401 dal global error handler |
| API service | `sharp` lancia (file corrotto / fake mime) | `throw new ServiceError(400, "Immagine non valida o corrotta")` |
| API service | S3 write fallisce | Rilancia (500 generico via global handler), client mostra toast generico |
| API service | DB update fallisce dopo S3 write | S3 rollback (`s3.delete(key)`), poi rilancia |
| API service | Cleanup vecchio file fallisce | Log `action: "avatar_old_cleanup_failed"`, NON blocca response (orfano gestito out-of-band in futuro) |
| Network | Fetch fallisce | `toast.error(profile_avatar_error_generic)`, dialog resta aperto |

---

## Test

### Integration tests API

Nuovo file `apps/api/tests/integration/me-avatar.test.ts` (pattern di `seller-products.test.ts`, testcontainers + MinIO):

1. `POST /me/avatar` come customer autenticato con JPEG valido → 200, `user.image` aggiornato a una URL nel nostro bucket, file raggiungibile via HTTP.
2. `POST /me/avatar` senza session → 401.
3. `POST /me/avatar` con `multipart/form-data` `file` di tipo `text/plain` → 400.
4. `POST /me/avatar` con file > 5MB → 400.
5. `POST /me/avatar` due volte di seguito → la response del secondo upload ha URL diversa; HEAD sul vecchio file restituisce 404.
6. `DELETE /me/avatar` → `user.image = null`, HEAD sul file restituisce 404.
7. `DELETE /me/avatar` quando già `null` → 200 (no-op).

### Niente unit test client

La logica `cropImageToBlob` usa `<canvas>` e `<img>` — testarla senza una vera implementazione canvas (jsdom-canvas) non porta confidence reale. Verifica via manual checklist sotto.

---

## Verification before completion

- `bun run typecheck` da root verde (3 app + api).
- `bun run lint` verde.
- `bun run --filter @bibs/api test:integration` verde, incluso il nuovo `me-avatar.test.ts`.
- `bun run db:generate` → nessuna migrazione necessaria (sanity check sul fatto che non si è modificato uno schema senza accorgersene).
- `curl localhost:3000/openapi | jq '.paths."/me/avatar"'` → mostra `post` e `delete` con `summary` Italiano e tag `Me`.
- `bun run dev:seller` + `dev:customer` + `dev:admin`: in `/profile`:
  - Caricare un'immagine, croppare, salvare → l'avatar nella card si aggiorna e quello nella sidebar/header pure (senza reload).
  - Rimuovere → torna alle iniziali, idem in sidebar/header.
  - Provare file `.txt` → toast d'errore, niente call.
  - Provare un PNG > 5MB → toast d'errore, niente call.
  - Refresh hard del browser → immagine persistita.
- Verifica visuale che il bottone "Rimuovi immagine" NON compaia se l'utente non ha un'immagine.

---

## Out of scope (nota)

- **Admin impersonation di avatar altrui**: non implementato qui. Se servirà, sarà un endpoint dedicato sotto `admin/` con permission check tramite il role plugin di Better Auth.
- **Cleanup S3 alla cancellazione utente**: non gestito né qui né nel resto del progetto. Va affrontato in modo uniforme per tutte le immagini (prodotti, store, utenti) in un job futuro.
- **Multi-size / thumbnail**: 512×512 è sufficiente per tutti gli usi attuali (avatar nav ≤ 40px, profilo ≤ 96px).
- **Avatar `<img loading="lazy">`**: i consumi correnti dell'avatar sono pochi per pagina, niente ottimizzazioni di loading.
- **Animazioni / transition sull'avatar nuovo**: il behaviour reattivo di Better Auth è "swap immediato"; nessuna fade.
