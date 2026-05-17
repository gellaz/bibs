# User Profile Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere a ogni utente autenticato (seller / admin / customer / employee) di caricare facoltativamente un'immagine del profilo, ritagliata in cerchio, riusata automaticamente da tutti gli `UserAvatar` dell'app.

**Architecture:** Nuovo modulo Elysia `me/` con endpoint `POST /me/avatar` (multipart, `t.File`) e `DELETE /me/avatar`. La pipeline server-side passa il file da `sharp` (resize-cover 512×512 JPEG), scrive su S3 con key `users/{userId}/{uuid}.jpg`, aggiorna `user.image` direttamente via Drizzle e cancella best-effort il file precedente. Lato client un `AvatarUploadDialog` (con `react-easy-crop`) condiviso in `@bibs/ui` apre un dialog cliccando sull'avatar nella PersonalInfoCard (anch'essa estratta in `@bibs/ui`); le 3 app diventano wrapper sottili che passano i callback Eden Treaty + Better Auth.

**Tech Stack:** Bun + Elysia (TypeBox `t.File`) + Drizzle ORM + Better Auth + S3 (MinIO in dev) + `sharp` server-side. React 19 + TanStack Start/Router + Eden Treaty + `react-easy-crop` + `@bibs/ui` (shadcn/Base UI) + sonner.

**Branch:** `feat/user-profile-image` (già creato, contiene la spec come commit di partenza).

**Spec:** `docs/superpowers/specs/2026-05-17-user-profile-image-design.md`

---

## File Structure

**API (Elysia + Drizzle + S3)**
- `apps/api/src/modules/me/services/avatar.ts` — **CREATE** — `uploadUserAvatar`, `deleteUserAvatar`, `extractOurKey` (helper interno).
- `apps/api/src/modules/me/routes/avatar.ts` — **CREATE** — POST/DELETE Elysia routes con `t.File` + `auth: true`.
- `apps/api/src/modules/me/index.ts` — **CREATE** — `meModule = new Elysia({ prefix: "/me" }).use(betterAuth).use(avatarRoutes)`.
- `apps/api/src/index.ts` — **MODIFY** — registrare `meModule`, aggiungere tag OpenAPI `"Me"`.
- `apps/api/tests/integration/me-avatar.test.ts` — **CREATE** — test service-level (mock S3, test DB) coerenti col pattern di `seller-products.test.ts`.

**Dipendenze backend**
- `package.json` (root) — **MODIFY** — aggiungere `"sharp": "^0.34.4"` al `catalog`.
- `apps/api/package.json` — **MODIFY** — aggiungere `"sharp": "catalog:"` in `dependencies`.

**UI condiviso (`@bibs/ui`)**
- `packages/ui/src/lib/crop-image.ts` — **CREATE** — util `cropImageToBlob(imageSrc, area): Promise<Blob>`.
- `packages/ui/src/components/avatar-upload-dialog.tsx` — **CREATE** — Dialog con `react-easy-crop`, validazione client, callback `onUpload`/`onRemove`.
- `packages/ui/src/components/personal-info-card.tsx` — **CREATE** — estrazione della PersonalInfoCard da seller/customer/admin con avatar cliccabile.

**Dipendenze UI**
- `package.json` (root) — **MODIFY** — aggiungere `"react-easy-crop": "^5.5.0"` al `catalog`.
- `packages/ui/package.json` — **MODIFY** — aggiungere `"react-easy-crop": "catalog:"` in `dependencies`.

**App wrappers**
- `apps/seller/src/features/profile/components/personal-info-card.tsx` — **REWRITE** — wrapper sottile usando `@bibs/ui/components/personal-info-card`.
- `apps/customer/src/routes/_authenticated/profile.tsx` — **REWRITE** — wrapper sottile usando `@bibs/ui/components/personal-info-card`.
- `apps/admin/src/routes/_authenticated/profile.tsx` — **REWRITE** — wrapper sottile usando `@bibs/ui/components/personal-info-card`.
- `apps/customer/src/routes/__root.tsx` — **MODIFY** — montare `<Toaster richColors />` (attualmente assente).

---

## Task 0: Aggiungere dipendenze al catalog e installare

**Files:**
- Modify: `package.json` (root catalog)
- Modify: `apps/api/package.json`
- Modify: `packages/ui/package.json`
- Modify: `bun.lock` (rigenerato da `bun install`)

- [ ] **Step 1: Aggiungi `sharp` e `react-easy-crop` al catalog root**

In `package.json` alla sezione `"catalog"`, inserisci in ordine alfabetico:

```json
		"react-easy-crop": "^5.5.0",
```

…e:

```json
		"sharp": "^0.34.4",
```

(Le versioni esatte vanno verificate al momento dell'install: `bun pm view sharp version` e `bun pm view react-easy-crop version` per usare le ultime stabili. Se le versioni sopra non esistono più, usa quelle correnti. Niente caret `latest` — bibs usa `^` floors espliciti.)

- [ ] **Step 2: Aggiungi le dipendenze ai workspace**

In `apps/api/package.json` → `dependencies` (ordine alfabetico):

```json
		"sharp": "catalog:",
```

In `packages/ui/package.json` → `dependencies` (ordine alfabetico):

```json
		"react-easy-crop": "catalog:",
```

- [ ] **Step 3: Installa e verifica**

```bash
bun install
```

Expected: tutti i workspace risolvono, niente warning su catalog. `bun.lock` aggiornato.

```bash
bun pm ls sharp | head
bun pm ls react-easy-crop | head
```

Expected: `sharp` presente in `apps/api` (e nelle sue dipendenze native, libvips compilato), `react-easy-crop` presente in `packages/ui`.

- [ ] **Step 4: Smoke test typecheck**

```bash
bun run typecheck
```

Expected: PASS (nessuna nuova regressione, le nuove dep non sono ancora usate).

- [ ] **Step 5: Commit**

```bash
git add package.json apps/api/package.json packages/ui/package.json bun.lock
git commit -m "chore(deps): add sharp and react-easy-crop for profile images"
```

---

## Task 1: Implementare il service `uploadUserAvatar` (TDD)

**Files:**
- Create: `apps/api/src/modules/me/services/avatar.ts`
- Test: `apps/api/tests/integration/me-avatar.test.ts`

- [ ] **Step 1: Scaffold del file di test**

Crea `apps/api/tests/integration/me-avatar.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

// S3 mock: tracciamo le chiamate write/delete per asserzioni
const s3WriteMock = mock(async (_key: string, _data: Buffer) => {});
const s3DeleteMock = mock(async (_key: string) => {});

mock.module("@/lib/s3", () => ({
	s3: { write: s3WriteMock, delete: s3DeleteMock },
	publicUrl: (key: string) => `http://test-bucket/${key}`,
}));

// env mock: ci serve S3_ENDPOINT e S3_BUCKET per extractOurKey
mock.module("@/lib/env", () => ({
	env: {
		S3_ENDPOINT: "http://test-bucket",
		S3_BUCKET: "",
	},
}));

// ── Imports (resolved after mocks) ────────────────────────────────────────────

import { eq } from "drizzle-orm";
import { user as userTable } from "@/db/schemas/auth";
import { ServiceError } from "@/lib/errors";
import {
	deleteUserAvatar,
	uploadUserAvatar,
} from "@/modules/me/services/avatar";
import { truncateAll } from "../helpers/cleanup";
import { createTestCustomer } from "../helpers/fixtures";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	s3WriteMock.mockClear();
	s3DeleteMock.mockClear();
});

// Genera un PNG 1×1 valido per i test (sharp lo accetta)
function makeTestImageFile(): File {
	// PNG 1×1 trasparente, base64
	const pngBase64 =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
	const buffer = Buffer.from(pngBase64, "base64");
	return new File([buffer], "test.png", { type: "image/png" });
}

describe("uploadUserAvatar", () => {
	it("scrive un file JPEG 512x512 su S3 e aggiorna user.image", async () => {
		const db = getTestDb();
		const { user } = await createTestCustomer(db);
		const file = makeTestImageFile();

		const result = await uploadUserAvatar({ userId: user.id, file });

		// S3 chiamata una volta con un buffer non vuoto
		expect(s3WriteMock).toHaveBeenCalledTimes(1);
		const [key, data] = s3WriteMock.mock.calls[0];
		expect(key).toMatch(new RegExp(`^users/${user.id}/[0-9a-f-]+\\.jpg$`));
		expect((data as Buffer).byteLength).toBeGreaterThan(0);

		// La URL ritornata punta al bucket
		expect(result.url).toBe(`http://test-bucket/${key}`);
		expect(result.key).toBe(key);

		// user.image aggiornato in DB
		const refreshed = await db.query.user.findFirst({
			where: eq(userTable.id, user.id),
		});
		expect(refreshed?.image).toBe(result.url);

		// Nessuna delete (era il primo upload)
		expect(s3DeleteMock).not.toHaveBeenCalled();
	});

	it("cancella il file precedente quando l'utente aveva già un'immagine nostra", async () => {
		const db = getTestDb();
		const { user } = await createTestCustomer(db);
		const oldKey = `users/${user.id}/old-uuid.jpg`;
		await db
			.update(userTable)
			.set({ image: `http://test-bucket/${oldKey}` })
			.where(eq(userTable.id, user.id));

		await uploadUserAvatar({ userId: user.id, file: makeTestImageFile() });

		// Aspettiamo un tick perché la delete è best-effort (non await)
		await new Promise((r) => setTimeout(r, 50));

		expect(s3DeleteMock).toHaveBeenCalledWith(oldKey);
	});

	it("NON cancella URL esterne (non del nostro bucket)", async () => {
		const db = getTestDb();
		const { user } = await createTestCustomer(db);
		await db
			.update(userTable)
			.set({ image: "https://lh3.googleusercontent.com/some-oauth-avatar.jpg" })
			.where(eq(userTable.id, user.id));

		await uploadUserAvatar({ userId: user.id, file: makeTestImageFile() });
		await new Promise((r) => setTimeout(r, 50));

		expect(s3DeleteMock).not.toHaveBeenCalled();
	});

	it("rilancia ServiceError 400 se il file non è un'immagine valida", async () => {
		const db = getTestDb();
		const { user } = await createTestCustomer(db);
		const badFile = new File([Buffer.from("not an image")], "fake.png", {
			type: "image/png",
		});

		await expect(
			uploadUserAvatar({ userId: user.id, file: badFile }),
		).rejects.toThrow(ServiceError);

		// Nessun side-effect
		expect(s3WriteMock).not.toHaveBeenCalled();
		const refreshed = await db.query.user.findFirst({
			where: eq(userTable.id, user.id),
		});
		expect(refreshed?.image).toBeNull();
	});
});

describe("deleteUserAvatar", () => {
	it("setta user.image a NULL e cancella il file da S3", async () => {
		const db = getTestDb();
		const { user } = await createTestCustomer(db);
		const key = `users/${user.id}/some-uuid.jpg`;
		await db
			.update(userTable)
			.set({ image: `http://test-bucket/${key}` })
			.where(eq(userTable.id, user.id));

		await deleteUserAvatar({ userId: user.id });

		const refreshed = await db.query.user.findFirst({
			where: eq(userTable.id, user.id),
		});
		expect(refreshed?.image).toBeNull();
		expect(s3DeleteMock).toHaveBeenCalledWith(key);
	});

	it("è no-op se l'utente non ha già un'immagine", async () => {
		const db = getTestDb();
		const { user } = await createTestCustomer(db);
		// image è già null per default

		await deleteUserAvatar({ userId: user.id });

		expect(s3DeleteMock).not.toHaveBeenCalled();
		const refreshed = await db.query.user.findFirst({
			where: eq(userTable.id, user.id),
		});
		expect(refreshed?.image).toBeNull();
	});
});
```

- [ ] **Step 2: Verifica che i test falliscano (modulo non esiste ancora)**

```bash
bun run --filter @bibs/api test:integration -- me-avatar
```

Expected: FAIL con qualcosa tipo `Cannot find module '@/modules/me/services/avatar'`.

- [ ] **Step 3: Implementa `apps/api/src/modules/me/services/avatar.ts`**

```ts
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user as userTable } from "@/db/schemas/auth";
import { ServiceError } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { publicUrl, s3 } from "@/lib/s3";

interface UploadUserAvatarParams {
	userId: string;
	file: File;
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

export async function uploadUserAvatar({
	userId,
	file,
}: UploadUserAvatarParams) {
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
	await s3.write(key, processed);

	// 4. Aggiorna user.image; rollback S3 se fallisce
	try {
		await db
			.update(userTable)
			.set({ image: url })
			.where(eq(userTable.id, userId));
	} catch (err) {
		await s3.delete(key).catch(() => {
			// rollback best-effort
		});
		throw err;
	}

	// 5. Cleanup best-effort del file precedente (non blocca la response)
	if (current?.image) {
		const oldKey = extractOurKey(current.image);
		if (oldKey) {
			s3.delete(oldKey).catch((err) => {
				logger.warn(
					{ userId, oldKey, action: "avatar_old_cleanup_failed", err: String(err) },
					"Cleanup vecchia immagine profilo fallito",
				);
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

	await db
		.update(userTable)
		.set({ image: null })
		.where(eq(userTable.id, userId));

	const oldKey = extractOurKey(current.image);
	if (oldKey) {
		await s3.delete(oldKey).catch((err) => {
			logger.warn(
				{ userId, oldKey, action: "avatar_old_cleanup_failed", err: String(err) },
				"Cleanup immagine profilo fallito durante DELETE",
			);
		});
	}
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

```bash
bun run --filter @bibs/api test:integration -- me-avatar
```

Expected: 6 test PASS.

Se `sharp` lancia in CI per mancanza di libvips, verifica che il container test abbia il binding nativo (`sharp` lo gestisce in fase install). Se i test integration fanno startup di MinIO ma noi abbiamo già mockato S3, il container DB rimane sufficiente.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/me/services/avatar.ts apps/api/tests/integration/me-avatar.test.ts
git commit -m "feat(api): add uploadUserAvatar and deleteUserAvatar services"
```

---

## Task 2: Wire delle route Elysia `/me/avatar`

**Files:**
- Create: `apps/api/src/modules/me/routes/avatar.ts`
- Create: `apps/api/src/modules/me/index.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Crea `apps/api/src/modules/me/routes/avatar.ts`**

```ts
import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { okMessage } from "@/lib/responses";
import { OkMessage, okRes, withErrors } from "@/lib/schemas";
import { deleteUserAvatar, uploadUserAvatar } from "../services/avatar";

const AvatarResponse = t.Object({
	image: t.String({ description: "URL pubblica della nuova immagine profilo" }),
});

export const avatarRoutes = new Elysia()
	.post(
		"/avatar",
		async (ctx) => {
			const { user, body, store } = ctx as typeof ctx & { user: { id: string } };
			const pino = getLogger(store);
			const result = await uploadUserAvatar({ userId: user.id, file: body.file });
			pino.info(
				{ userId: user.id, action: "user_avatar_uploaded", key: result.key },
				"Immagine profilo aggiornata",
			);
			return { success: true as const, data: { image: result.url } };
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
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.delete(
		"/avatar",
		async (ctx) => {
			const { user, store } = ctx as typeof ctx & { user: { id: string } };
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
				security: [{ bearerAuth: [] }],
			},
		},
	);
```

> Nota: il cast `ctx as typeof ctx & { user: { id: string } }` è necessario perché la macro `auth: true` di Elysia inferisce `user` runtime ma il type non sempre arriva al body handler senza guard. Se notiamo che altri moduli (es. `seller-stores`) lo evitano elegantemente, allinea allo stile preferito.

- [ ] **Step 2: Crea `apps/api/src/modules/me/index.ts`**

```ts
import { Elysia } from "elysia";
import { betterAuth } from "@/plugins/better-auth";
import { avatarRoutes } from "./routes/avatar";

export const meModule = new Elysia({ prefix: "/me" })
	.use(betterAuth)
	.use(avatarRoutes);
```

- [ ] **Step 3: Registra il modulo in `apps/api/src/index.ts`**

Aggiungi l'import (in ordine alfabetico con gli altri `@/modules/...`):

```ts
import { meModule } from "@/modules/me";
```

Aggiungi `.use(meModule)` nella catena, dopo `.use(customerModule)`:

```ts
	.use(sellerModule)
	.use(customerModule)
	.use(meModule)
	.use(cronJobs)
```

Aggiungi il tag OpenAPI nell'array `tags` (in ordine alfabetico):

```ts
{ name: "Me", description: "Profilo dell'utente corrente" },
```

- [ ] **Step 4: Avvia l'API in dev e verifica gli endpoint via OpenAPI**

```bash
bun run dev:api &
API_PID=$!
sleep 3
curl -s http://localhost:3000/openapi/json | bun -e "
const data = JSON.parse(await Bun.stdin.text());
console.log('POST /me/avatar:', Boolean(data.paths['/me/avatar']?.post));
console.log('DELETE /me/avatar:', Boolean(data.paths['/me/avatar']?.delete));
console.log('Tag Me presente:', data.tags.some(t => t.name === 'Me'));
"
kill $API_PID
```

Expected: tutte e tre le righe stampano `true`.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/me apps/api/src/index.ts
git commit -m "feat(api): expose POST/DELETE /me/avatar endpoints"
```

---

## Task 3: Util `cropImageToBlob` in `@bibs/ui`

**Files:**
- Create: `packages/ui/src/lib/crop-image.ts`

- [ ] **Step 1: Implementa la util**

Crea `packages/ui/src/lib/crop-image.ts`:

```ts
export interface CropArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

const OUTPUT_SIZE = 512;

/**
 * Ritaglia `imageSrc` sulla regione `area` (in pixel della sorgente originale)
 * e produce un Blob JPEG quadrato di OUTPUT_SIZE × OUTPUT_SIZE pixel.
 *
 * Usato da AvatarUploadDialog dopo la conferma del crop di react-easy-crop.
 */
export async function cropImageToBlob(
	imageSrc: string,
	area: CropArea,
): Promise<Blob> {
	const img = await loadImage(imageSrc);
	const canvas = document.createElement("canvas");
	canvas.width = OUTPUT_SIZE;
	canvas.height = OUTPUT_SIZE;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D context non disponibile");

	ctx.drawImage(
		img,
		area.x,
		area.y,
		area.width,
		area.height,
		0,
		0,
		OUTPUT_SIZE,
		OUTPUT_SIZE,
	);

	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (!blob) reject(new Error("Generazione blob fallita"));
				else resolve(blob);
			},
			"image/jpeg",
			0.9,
		);
	});
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Caricamento immagine fallito"));
		img.crossOrigin = "anonymous";
		img.src = src;
	});
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/crop-image.ts
git commit -m "feat(ui): add cropImageToBlob util for avatar crop"
```

---

## Task 4: Componente `AvatarUploadDialog` in `@bibs/ui`

**Files:**
- Create: `packages/ui/src/components/avatar-upload-dialog.tsx`

- [ ] **Step 1: Implementa il dialog**

Crea `packages/ui/src/components/avatar-upload-dialog.tsx`:

```tsx
"use client";

import * as React from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button } from "~/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/dialog";
import { Slider } from "~/components/slider";
import { toast } from "~/components/sonner";
import { UserAvatar } from "~/components/user-avatar";
import { cropImageToBlob } from "~/lib/crop-image";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
]);

export interface AvatarUploadDialogLabels {
	title: string;
	description: string;
	chooseFile: string;
	cropHelp: string;
	save: string;
	cancel: string;
	back: string;
	remove: string;
	errorInvalidType: string;
	errorTooLarge: string;
	errorGeneric: string;
}

export interface AvatarUploadDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentImage?: string | null;
	name?: string | null;
	onUpload: (file: File) => Promise<void>;
	onRemove?: () => Promise<void>;
	labels: AvatarUploadDialogLabels;
}

export function AvatarUploadDialog({
	open,
	onOpenChange,
	currentImage,
	name,
	onUpload,
	onRemove,
	labels,
}: AvatarUploadDialogProps) {
	const [imageSrc, setImageSrc] = React.useState<string | null>(null);
	const [crop, setCrop] = React.useState({ x: 0, y: 0 });
	const [zoom, setZoom] = React.useState(1);
	const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(
		null,
	);
	const [isSaving, setIsSaving] = React.useState(false);
	const [isRemoving, setIsRemoving] = React.useState(false);

	const fileInputRef = React.useRef<HTMLInputElement>(null);

	const resetState = React.useCallback(() => {
		if (imageSrc) URL.revokeObjectURL(imageSrc);
		setImageSrc(null);
		setCrop({ x: 0, y: 0 });
		setZoom(1);
		setCroppedAreaPixels(null);
		setIsSaving(false);
		setIsRemoving(false);
		if (fileInputRef.current) fileInputRef.current.value = "";
	}, [imageSrc]);

	// Reset when dialog closes
	React.useEffect(() => {
		if (!open) resetState();
	}, [open, resetState]);

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		if (!ACCEPTED_TYPES.has(file.type)) {
			toast.error(labels.errorInvalidType);
			event.target.value = "";
			return;
		}
		if (file.size > MAX_BYTES) {
			toast.error(labels.errorTooLarge);
			event.target.value = "";
			return;
		}
		const url = URL.createObjectURL(file);
		setImageSrc(url);
	};

	const handleSave = async () => {
		if (!imageSrc || !croppedAreaPixels) return;
		setIsSaving(true);
		try {
			const blob = await cropImageToBlob(imageSrc, croppedAreaPixels);
			const file = new File([blob], "avatar.jpg", { type: "image/jpeg" });
			await onUpload(file);
			onOpenChange(false);
		} catch (err) {
			toast.error(labels.errorGeneric);
			console.error(err);
		} finally {
			setIsSaving(false);
		}
	};

	const handleRemove = async () => {
		if (!onRemove) return;
		setIsRemoving(true);
		try {
			await onRemove();
			onOpenChange(false);
		} catch (err) {
			toast.error(labels.errorGeneric);
			console.error(err);
		} finally {
			setIsRemoving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{labels.title}</DialogTitle>
					<DialogDescription>{labels.description}</DialogDescription>
				</DialogHeader>

				{imageSrc ? (
					<div className="flex flex-col gap-3">
						<div className="relative h-64 w-full overflow-hidden rounded-md bg-muted">
							<Cropper
								image={imageSrc}
								crop={crop}
								zoom={zoom}
								aspect={1}
								cropShape="round"
								showGrid={false}
								onCropChange={setCrop}
								onZoomChange={setZoom}
								onCropComplete={(_, area) => setCroppedAreaPixels(area)}
							/>
						</div>
						<p className="text-xs text-muted-foreground">{labels.cropHelp}</p>
						<div className="flex items-center gap-3">
							<span className="text-xs text-muted-foreground">1×</span>
							<Slider
								value={[zoom]}
								min={1}
								max={3}
								step={0.05}
								onValueChange={(v) => setZoom(v[0] ?? 1)}
							/>
							<span className="text-xs text-muted-foreground">3×</span>
						</div>
					</div>
				) : (
					<div className="flex flex-col items-center gap-4 py-4">
						<UserAvatar
							name={name}
							image={currentImage}
							className="size-32 text-3xl"
						/>
						<input
							ref={fileInputRef}
							type="file"
							accept="image/png,image/jpeg,image/webp"
							onChange={handleFileChange}
							className="hidden"
						/>
						<Button
							type="button"
							onClick={() => fileInputRef.current?.click()}
						>
							{labels.chooseFile}
						</Button>
					</div>
				)}

				<DialogFooter className="flex-row justify-between sm:justify-between">
					{imageSrc ? (
						<>
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									URL.revokeObjectURL(imageSrc);
									setImageSrc(null);
								}}
								disabled={isSaving}
							>
								{labels.back}
							</Button>
							<Button type="button" onClick={handleSave} disabled={isSaving}>
								{isSaving ? "..." : labels.save}
							</Button>
						</>
					) : (
						<>
							{currentImage && onRemove ? (
								<Button
									type="button"
									variant="destructive"
									onClick={handleRemove}
									disabled={isRemoving}
								>
									{isRemoving ? "..." : labels.remove}
								</Button>
							) : (
								<span />
							)}
							<Button
								type="button"
								variant="ghost"
								onClick={() => onOpenChange(false)}
							>
								{labels.cancel}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
```

- [ ] **Step 2: Verifica che il Slider esiste in `@bibs/ui`**

```bash
ls packages/ui/src/components/slider.tsx
```

Expected: file presente. Se manca:

```bash
cd packages/ui && bun x shadcn@latest add slider
```

(Per la regola memory `shadcnblocks_gotchas`: sempre `cd packages/ui` prima del CLI.)

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/avatar-upload-dialog.tsx packages/ui/src/components/slider.tsx
git commit -m "feat(ui): add AvatarUploadDialog with circular crop"
```

> Se `slider.tsx` esisteva già, omettilo dal `git add`.

---

## Task 5: Componente condiviso `PersonalInfoCard` in `@bibs/ui`

**Files:**
- Create: `packages/ui/src/components/personal-info-card.tsx`

- [ ] **Step 1: Implementa la card condivisa**

Crea `packages/ui/src/components/personal-info-card.tsx`:

```tsx
"use client";

import * as React from "react";
import {
	AvatarUploadDialog,
	type AvatarUploadDialogLabels,
} from "~/components/avatar-upload-dialog";
import { Button } from "~/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/card";
import { Field, FieldError, FieldLabel } from "~/components/field";
import { Input } from "~/components/input";
import { UserAvatar } from "~/components/user-avatar";
import { cn } from "~/lib/utils";

export interface PersonalInfoCardLabels {
	cardTitle: string;
	cardDescription: string;
	avatarEdit: string;
	firstName: string;
	firstNamePlaceholder: string;
	firstNameRequired: string;
	lastName: string;
	lastNamePlaceholder: string;
	lastNameRequired: string;
	birthDate: string;
	save: string;
	saving: string;
	successUpdate: string;
	errorUpdate: string;
	avatar: AvatarUploadDialogLabels;
}

export interface PersonalInfoCardValues {
	firstName?: string | null;
	lastName?: string | null;
	birthDate?: string | null;
	image?: string | null;
	name?: string | null;
}

export interface PersonalInfoCardProps {
	values: PersonalInfoCardValues;
	onSubmit: (data: {
		firstName: string;
		lastName: string;
		birthDate?: string;
	}) => Promise<{ error?: string }>;
	onUploadAvatar: (file: File) => Promise<void>;
	onRemoveAvatar: () => Promise<void>;
	labels: PersonalInfoCardLabels;
	className?: string;
}

export function PersonalInfoCard({
	values,
	onSubmit,
	onUploadAvatar,
	onRemoveAvatar,
	labels,
	className,
}: PersonalInfoCardProps) {
	const [firstName, setFirstName] = React.useState("");
	const [lastName, setLastName] = React.useState("");
	const [birthDate, setBirthDate] = React.useState("");
	const [touched, setTouched] = React.useState({
		firstName: false,
		lastName: false,
	});
	const [isSubmitting, setIsSubmitting] = React.useState(false);
	const [apiError, setApiError] = React.useState("");
	const [success, setSuccess] = React.useState(false);
	const [dialogOpen, setDialogOpen] = React.useState(false);

	// Sync external values into form
	React.useEffect(() => {
		setFirstName(values.firstName ?? "");
		setLastName(values.lastName ?? "");
		setBirthDate(values.birthDate ?? "");
		setTouched({ firstName: false, lastName: false });
	}, [values.firstName, values.lastName, values.birthDate]);

	const initialValuesKey = `${values.firstName ?? ""}|${values.lastName ?? ""}|${values.birthDate ?? ""}`;
	const currentValuesKey = `${firstName}|${lastName}|${birthDate}`;
	const isDirty = initialValuesKey !== currentValuesKey;

	const firstNameError = touched.firstName && !firstName.trim()
		? labels.firstNameRequired
		: undefined;
	const lastNameError = touched.lastName && !lastName.trim()
		? labels.lastNameRequired
		: undefined;

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setTouched({ firstName: true, lastName: true });
		if (!firstName.trim() || !lastName.trim()) return;

		setApiError("");
		setSuccess(false);
		setIsSubmitting(true);
		try {
			const result = await onSubmit({
				firstName: firstName.trim(),
				lastName: lastName.trim(),
				birthDate: birthDate || undefined,
			});
			if (result.error) {
				setApiError(result.error);
				return;
			}
			setSuccess(true);
		} catch {
			setApiError(labels.errorUpdate);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<>
			<Card className={cn(className)}>
				<CardHeader>
					<CardTitle>{labels.cardTitle}</CardTitle>
					<CardDescription>{labels.cardDescription}</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						<div className="flex flex-col items-center gap-2 pb-2">
							<button
								type="button"
								onClick={() => setDialogOpen(true)}
								className="group relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
								aria-label={labels.avatarEdit}
							>
								<UserAvatar
									name={values.name}
									image={values.image}
									className="size-24 text-2xl transition group-hover:opacity-80"
								/>
								<span className="absolute inset-0 hidden items-center justify-center rounded-full bg-black/40 text-xs font-medium text-white group-hover:flex">
									{labels.avatarEdit}
								</span>
							</button>
						</div>

						{apiError && (
							<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
								{apiError}
							</div>
						)}
						{success && (
							<div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
								{labels.successUpdate}
							</div>
						)}

						<div className="grid grid-cols-2 gap-4">
							<Field data-invalid={!!firstNameError}>
								<FieldLabel htmlFor="firstName" required>
									{labels.firstName}
								</FieldLabel>
								<Input
									id="firstName"
									placeholder={labels.firstNamePlaceholder}
									autoFocus
									value={firstName}
									onChange={(e) => setFirstName(e.target.value)}
									onBlur={() =>
										setTouched((t) => ({ ...t, firstName: true }))
									}
								/>
								<FieldError
									errors={firstNameError ? [{ message: firstNameError }] : []}
								/>
							</Field>

							<Field data-invalid={!!lastNameError}>
								<FieldLabel htmlFor="lastName" required>
									{labels.lastName}
								</FieldLabel>
								<Input
									id="lastName"
									placeholder={labels.lastNamePlaceholder}
									value={lastName}
									onChange={(e) => setLastName(e.target.value)}
									onBlur={() =>
										setTouched((t) => ({ ...t, lastName: true }))
									}
								/>
								<FieldError
									errors={lastNameError ? [{ message: lastNameError }] : []}
								/>
							</Field>
						</div>

						<Field>
							<FieldLabel htmlFor="birthDate">{labels.birthDate}</FieldLabel>
							<Input
								id="birthDate"
								type="date"
								value={birthDate}
								onChange={(e) => setBirthDate(e.target.value)}
							/>
						</Field>

						<Button
							type="submit"
							disabled={isSubmitting || !isDirty}
							className="mt-2 w-full"
						>
							{isSubmitting ? labels.saving : labels.save}
						</Button>
					</form>
				</CardContent>
			</Card>

			<AvatarUploadDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				currentImage={values.image}
				name={values.name}
				onUpload={onUploadAvatar}
				onRemove={onRemoveAvatar}
				labels={labels.avatar}
			/>
		</>
	);
}
```

> Nota: il design originale (react-hook-form + zodResolver) è stato sostituito da uno stato uncontrolled per **eliminare** la dipendenza form-libraries dal componente UI condiviso (resta agnostico dalle 3 app, niente catalog peer-dep ridondanti). Il pattern di FieldError accetta oggetti `{ message }` come `errors`, identico all'attuale uso in seller.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/personal-info-card.tsx
git commit -m "feat(ui): extract shared PersonalInfoCard with avatar upload"
```

---

## Task 6: Wrapper PersonalInfoCard nell'app seller

**Files:**
- Modify (full rewrite): `apps/seller/src/features/profile/components/personal-info-card.tsx`

- [ ] **Step 1: Riscrivi il file come wrapper**

Sovrascrivi `apps/seller/src/features/profile/components/personal-info-card.tsx`:

```tsx
import {
	PersonalInfoCard as SharedPersonalInfoCard,
	type PersonalInfoCardLabels,
} from "@bibs/ui/components/personal-info-card";
import { toast } from "@bibs/ui/components/sonner";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const LABELS: PersonalInfoCardLabels = {
	cardTitle: "Il mio profilo",
	cardDescription: "Aggiorna le tue informazioni personali",
	avatarEdit: "Modifica",
	firstName: "Nome",
	firstNamePlaceholder: "Mario",
	firstNameRequired: "Il nome è obbligatorio",
	lastName: "Cognome",
	lastNamePlaceholder: "Rossi",
	lastNameRequired: "Il cognome è obbligatorio",
	birthDate: "Data di nascita",
	save: "Salva modifiche",
	saving: "Salvataggio...",
	successUpdate: "Profilo aggiornato con successo",
	errorUpdate: "Errore durante il salvataggio. Riprova.",
	avatar: {
		title: "Immagine profilo",
		description: "Carica una foto e ritagliala in cerchio",
		chooseFile: "Scegli file",
		cropHelp: "Trascina per spostare, usa lo slider per ingrandire",
		save: "Salva",
		cancel: "Annulla",
		back: "Indietro",
		remove: "Rimuovi immagine",
		errorInvalidType: "Formato non supportato. Usa PNG, JPEG o WebP.",
		errorTooLarge: "File troppo grande. Massimo 5MB.",
		errorGeneric: "Errore durante il caricamento. Riprova.",
	},
};

export function PersonalInfoCard() {
	const { data: session, refetch } = authClient.useSession();
	const user = session?.user;

	const onSubmit = async (data: {
		firstName: string;
		lastName: string;
		birthDate?: string;
	}) => {
		const { error } = await authClient.updateUser({
			firstName: data.firstName,
			lastName: data.lastName,
			birthDate: data.birthDate,
			name: `${data.firstName} ${data.lastName}`,
		});
		return { error: error?.message };
	};

	const onUploadAvatar = async (file: File) => {
		const res = await api().me.avatar.post({ file });
		if (res.error) {
			throw new Error(
				typeof res.error.value === "object" && res.error.value && "message" in res.error.value
					? String((res.error.value as { message: string }).message)
					: "Errore",
			);
		}
		await refetch();
		toast.success("Immagine profilo aggiornata");
	};

	const onRemoveAvatar = async () => {
		const res = await api().me.avatar.delete();
		if (res.error) {
			throw new Error(
				typeof res.error.value === "object" && res.error.value && "message" in res.error.value
					? String((res.error.value as { message: string }).message)
					: "Errore",
			);
		}
		await refetch();
		toast.success("Immagine profilo rimossa");
	};

	return (
		<SharedPersonalInfoCard
			values={{
				firstName: user?.firstName,
				lastName: user?.lastName,
				birthDate: user?.birthDate,
				image: user?.image,
				name: user?.name,
			}}
			onSubmit={onSubmit}
			onUploadAvatar={onUploadAvatar}
			onRemoveAvatar={onRemoveAvatar}
			labels={LABELS}
		/>
	);
}
```

> Nota su `refetch`: alla data dello spec, `authClient.useSession()` di Better Auth React espone `refetch` come funzione restituita. Se TS non lo riconosce dal type generato da `@bibs/api`, fallback su `authClient.getSession({ query: { disableCookieCache: true } })` (le re-render comunque si propagano via `useSession()` perché Better Auth invalida l'internal store).

- [ ] **Step 2: Typecheck nell'app seller**

```bash
bun run --filter @bibs/seller typecheck
```

Expected: PASS. Se `refetch` non è tipato, sostituiscilo con la fallback `authClient.getSession({ query: { disableCookieCache: true } })` chiamato `await refetch()` → diventa una funzione locale.

- [ ] **Step 3: Smoke test in browser**

```bash
bun run dev:seller &
SELLER_PID=$!
sleep 4
```

Apri `http://localhost:3002/profile`, verifica che:
1. La card mostra l'avatar grande con iniziali.
2. Click sull'avatar → dialog aperto.
3. Dialog si chiude con "Annulla".

```bash
kill $SELLER_PID
```

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/features/profile/components/personal-info-card.tsx
git commit -m "feat(seller): wire shared PersonalInfoCard with avatar upload"
```

---

## Task 7: Wrapper PersonalInfoCard nell'app customer + Toaster

**Files:**
- Modify (rewrite): `apps/customer/src/routes/_authenticated/profile.tsx`
- Modify: `apps/customer/src/routes/__root.tsx`

- [ ] **Step 1: Aggiungi `<Toaster />` al root del customer**

In `apps/customer/src/routes/__root.tsx`, aggiungi import (in cima, in ordine alfabetico tra gli import di `@bibs/ui/components/*`):

```ts
import { Toaster } from "@bibs/ui/components/sonner";
```

Trova il blocco `<TanStackQueryProvider>...<TooltipProvider>...<Outlet />...</TooltipProvider>...</TanStackQueryProvider>` e aggiungi `<Toaster richColors position="top-right" />` come **fratello** di `<TooltipProvider>` (stesso pattern dell'admin/seller, ma posizione coerente con seller):

```tsx
				<TanStackQueryProvider>
					<TooltipProvider>
						<Outlet />
					</TooltipProvider>
					<Toaster richColors position="top-right" />
					<TanStackDevtools
```

- [ ] **Step 2: Riscrivi `apps/customer/src/routes/_authenticated/profile.tsx`**

```tsx
import {
	PersonalInfoCard as SharedPersonalInfoCard,
	type PersonalInfoCardLabels,
} from "@bibs/ui/components/personal-info-card";
import { toast } from "@bibs/ui/components/sonner";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/profile")({
	component: ProfilePage,
});

const LABELS: PersonalInfoCardLabels = {
	cardTitle: "Il mio profilo",
	cardDescription: "Aggiorna le tue informazioni personali",
	avatarEdit: "Modifica",
	firstName: "Nome",
	firstNamePlaceholder: "Mario",
	firstNameRequired: "Il nome è obbligatorio",
	lastName: "Cognome",
	lastNamePlaceholder: "Rossi",
	lastNameRequired: "Il cognome è obbligatorio",
	birthDate: "Data di nascita",
	save: "Salva modifiche",
	saving: "Salvataggio...",
	successUpdate: "Profilo aggiornato con successo",
	errorUpdate: "Errore durante il salvataggio. Riprova.",
	avatar: {
		title: "Immagine profilo",
		description: "Carica una foto e ritagliala in cerchio",
		chooseFile: "Scegli file",
		cropHelp: "Trascina per spostare, usa lo slider per ingrandire",
		save: "Salva",
		cancel: "Annulla",
		back: "Indietro",
		remove: "Rimuovi immagine",
		errorInvalidType: "Formato non supportato. Usa PNG, JPEG o WebP.",
		errorTooLarge: "File troppo grande. Massimo 5MB.",
		errorGeneric: "Errore durante il caricamento. Riprova.",
	},
};

function ProfilePage() {
	const { data: session, refetch } = authClient.useSession();
	const user = session?.user;

	const onSubmit = async (data: {
		firstName: string;
		lastName: string;
		birthDate?: string;
	}) => {
		const { error } = await authClient.updateUser({
			firstName: data.firstName,
			lastName: data.lastName,
			birthDate: data.birthDate,
			name: `${data.firstName} ${data.lastName}`,
		});
		return { error: error?.message };
	};

	const onUploadAvatar = async (file: File) => {
		const res = await api().me.avatar.post({ file });
		if (res.error) throw new Error("Errore upload");
		await refetch();
		toast.success("Immagine profilo aggiornata");
	};

	const onRemoveAvatar = async () => {
		const res = await api().me.avatar.delete();
		if (res.error) throw new Error("Errore");
		await refetch();
		toast.success("Immagine profilo rimossa");
	};

	return (
		<div className="flex min-h-screen items-center justify-center px-4 py-8">
			<SharedPersonalInfoCard
				values={{
					firstName: user?.firstName,
					lastName: user?.lastName,
					birthDate: user?.birthDate,
					image: user?.image,
					name: user?.name,
				}}
				onSubmit={onSubmit}
				onUploadAvatar={onUploadAvatar}
				onRemoveAvatar={onRemoveAvatar}
				labels={LABELS}
				className="w-full max-w-md"
			/>
		</div>
	);
}
```

- [ ] **Step 3: Typecheck nell'app customer**

```bash
bun run --filter @bibs/customer typecheck
```

Expected: PASS.

- [ ] **Step 4: Smoke test in browser**

```bash
bun run dev:customer &
CUSTOMER_PID=$!
sleep 4
```

Apri `http://localhost:3001/profile`, verifica avatar cliccabile, dialog apre/chiude. Verifica che un toast appare (puoi cliccare salva con form pulito → niente, ma il flow è coperto in Task 9).

```bash
kill $CUSTOMER_PID
```

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/routes/_authenticated/profile.tsx apps/customer/src/routes/__root.tsx
git commit -m "feat(customer): wire shared PersonalInfoCard with avatar upload"
```

---

## Task 8: Wrapper PersonalInfoCard nell'app admin

**Files:**
- Modify (rewrite): `apps/admin/src/routes/_authenticated/profile.tsx`

- [ ] **Step 1: Riscrivi il file**

```tsx
import {
	PersonalInfoCard as SharedPersonalInfoCard,
	type PersonalInfoCardLabels,
} from "@bibs/ui/components/personal-info-card";
import { toast } from "@bibs/ui/components/sonner";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/profile")({
	component: ProfilePage,
});

const LABELS: PersonalInfoCardLabels = {
	cardTitle: "Il mio profilo",
	cardDescription: "Aggiorna le tue informazioni personali",
	avatarEdit: "Modifica",
	firstName: "Nome",
	firstNamePlaceholder: "Mario",
	firstNameRequired: "Il nome è obbligatorio",
	lastName: "Cognome",
	lastNamePlaceholder: "Rossi",
	lastNameRequired: "Il cognome è obbligatorio",
	birthDate: "Data di nascita",
	save: "Salva modifiche",
	saving: "Salvataggio...",
	successUpdate: "Profilo aggiornato con successo",
	errorUpdate: "Errore durante il salvataggio. Riprova.",
	avatar: {
		title: "Immagine profilo",
		description: "Carica una foto e ritagliala in cerchio",
		chooseFile: "Scegli file",
		cropHelp: "Trascina per spostare, usa lo slider per ingrandire",
		save: "Salva",
		cancel: "Annulla",
		back: "Indietro",
		remove: "Rimuovi immagine",
		errorInvalidType: "Formato non supportato. Usa PNG, JPEG o WebP.",
		errorTooLarge: "File troppo grande. Massimo 5MB.",
		errorGeneric: "Errore durante il caricamento. Riprova.",
	},
};

function ProfilePage() {
	const { data: session, refetch } = authClient.useSession();
	const user = session?.user;

	const onSubmit = async (data: {
		firstName: string;
		lastName: string;
		birthDate?: string;
	}) => {
		const { error } = await authClient.updateUser({
			firstName: data.firstName,
			lastName: data.lastName,
			birthDate: data.birthDate,
			name: `${data.firstName} ${data.lastName}`,
		});
		return { error: error?.message };
	};

	const onUploadAvatar = async (file: File) => {
		const res = await api().me.avatar.post({ file });
		if (res.error) throw new Error("Errore upload");
		await refetch();
		toast.success("Immagine profilo aggiornata");
	};

	const onRemoveAvatar = async () => {
		const res = await api().me.avatar.delete();
		if (res.error) throw new Error("Errore");
		await refetch();
		toast.success("Immagine profilo rimossa");
	};

	return (
		<SharedPersonalInfoCard
			values={{
				firstName: user?.firstName,
				lastName: user?.lastName,
				birthDate: user?.birthDate,
				image: user?.image,
				name: user?.name,
			}}
			onSubmit={onSubmit}
			onUploadAvatar={onUploadAvatar}
			onRemoveAvatar={onRemoveAvatar}
			labels={LABELS}
			className="max-w-md"
		/>
	);
}
```

- [ ] **Step 2: Typecheck nell'app admin**

```bash
bun run --filter @bibs/admin typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/routes/_authenticated/profile.tsx
git commit -m "feat(admin): wire shared PersonalInfoCard with avatar upload"
```

---

## Task 9: Manual verification end-to-end

**Files:**
- (verifica solo, niente file modificato in questo task tranne eventuali fix)

- [ ] **Step 1: Lint + typecheck root**

```bash
bun run lint
bun run typecheck
```

Expected: entrambi PASS. Memory `bun_filter_exit_codes` ti ricorda di controllare `$?` esplicitamente — esegui:

```bash
bun run typecheck; echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 2: Test integration API**

```bash
bun run --filter @bibs/api test:integration -- me-avatar; echo "exit=$?"
```

Expected: `exit=0`, 6 test PASS.

- [ ] **Step 3: Verifica OpenAPI con API in dev**

```bash
docker compose up -d --wait
bun run dev:api &
API_PID=$!
sleep 4
curl -s http://localhost:3000/openapi/json | bun -e "
const d = JSON.parse(await Bun.stdin.text());
const p = d.paths['/me/avatar'];
console.log('POST summary:', p?.post?.summary);
console.log('POST tag:', p?.post?.tags?.[0]);
console.log('DELETE summary:', p?.delete?.summary);
"
```

Expected:
```
POST summary: Carica immagine profilo
POST tag: Me
DELETE summary: Rimuovi immagine profilo
```

Lascia l'API in run per i prossimi step (non killare).

- [ ] **Step 4: E2E seller — upload + crop + remove**

```bash
bun run dev:seller &
SELLER_PID=$!
sleep 4
```

In un browser:
1. Login come seller esistente (o crea uno via flow di registrazione).
2. Vai su `/profile`.
3. Click sull'avatar grande → dialog si apre con avatar iniziali.
4. Click "Scegli file", seleziona un PNG/JPEG ≤ 5MB.
5. Dialog passa al cropper, fai zoom/drag.
6. Click "Salva".
7. **Verifica**: toast "Immagine profilo aggiornata", dialog chiuso, avatar nella card aggiornato, avatar nella sidebar (NavUser) anche aggiornato — **senza reload**.
8. Refresh hard del browser → immagine persistita.
9. Riapri il dialog → click "Rimuovi immagine" → toast "Immagine profilo rimossa", avatar torna alle iniziali in card + sidebar.
10. Riapri il dialog → prova a caricare un `.txt` → toast errore "Formato non supportato".
11. Prova a caricare un PNG > 5MB → toast errore "File troppo grande".

```bash
kill $SELLER_PID
```

- [ ] **Step 5: E2E customer — stesso scenario**

```bash
bun run dev:customer &
CUSTOMER_PID=$!
sleep 4
```

Apri `http://localhost:3001/profile`, ripeti gli step 3–11 del Task 9.4. L'avatar in `HeaderUser` (in alto) deve aggiornarsi reattivamente.

```bash
kill $CUSTOMER_PID
```

- [ ] **Step 6: E2E admin — stesso scenario**

```bash
bun run dev:admin &
ADMIN_PID=$!
sleep 4
```

Apri `http://localhost:3003/profile`, ripeti gli step 3–11. NavUser admin deve aggiornarsi.

```bash
kill $ADMIN_PID
kill $API_PID
```

- [ ] **Step 7: Verifica file su MinIO (opzionale)**

```bash
docker compose exec minio mc ls local/bibs/users/ 2>/dev/null | head
```

Expected: vedi `users/{userId}/` con uno o più file `.jpg` (uno per upload corrente, gli orfani di vecchi upload sono ammessi se non sono stati ancora puliti — ma il cleanup best-effort dovrebbe averli tolti).

- [ ] **Step 8: Sanity check schema (nessuna migrazione introdotta involontariamente)**

```bash
bun run db:generate
```

Expected: nessun file SQL generato (lo schema `user` è invariato).

- [ ] **Step 9: Commit finale di pulizia (se serve)**

Se durante l'E2E hai dovuto fixare qualche bug minore, committa con scope coerente. Altrimenti salta.

- [ ] **Step 10: Push del branch e apertura PR**

```bash
git push -u origin feat/user-profile-image
gh pr create --title "feat(profile): optional user profile image with circular crop" --body "$(cat <<'EOF'
## Summary
- Aggiunge `POST /me/avatar` e `DELETE /me/avatar` nell'API (nuovo modulo `me/`).
- Pipeline server con `sharp` → JPEG 512×512, salvataggio su S3 `users/{userId}/{uuid}.jpg`, cleanup best-effort del file precedente.
- Nuovo `AvatarUploadDialog` in `@bibs/ui` con `react-easy-crop` (cropShape circolare).
- `PersonalInfoCard` estratta in `@bibs/ui` e riusata in seller / customer / admin (de-duplica 3 copie quasi identiche).
- Toaster montato anche nel customer root.

## Test plan
- [x] `bun run --filter @bibs/api test:integration -- me-avatar` verde (6 test).
- [x] `bun run typecheck` verde.
- [x] `bun run lint` verde.
- [x] E2E manuale seller / customer / admin: upload + crop + remove + persistenza dopo reload.
- [x] Validazione client: `.txt` e file > 5MB rifiutati con toast.
- [x] Nessuna migrazione DB generata (`user.image` riusato da Better Auth).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR creata. URL stampato.

---

## Self-Review (eseguito dopo aver scritto il piano)

**Spec coverage**:
- [x] Schema DB invariato — Task 0 non tocca schemi, Task 9.8 verifica.
- [x] `POST /me/avatar` con `t.File` 5MB — Task 2.1.
- [x] `DELETE /me/avatar` — Task 2.1.
- [x] Pipeline `sharp` 512×512 JPEG — Task 1.3.
- [x] S3 key `users/{userId}/{uuid}.jpg` + cleanup vecchio — Task 1.3.
- [x] Rollback S3 su DB fail — Task 1.3.
- [x] Auth via macro `auth: true` — Task 2.1.
- [x] OpenAPI tag `Me` italiano — Task 2.3.
- [x] AvatarUploadDialog con react-easy-crop — Task 4.
- [x] Crop circolare 1:1, zoom 1–3× — Task 4.1.
- [x] Validazione client mime/size — Task 4.1.
- [x] Util `cropImageToBlob` — Task 3.
- [x] PersonalInfoCard estratta in `@bibs/ui` — Task 5.
- [x] Wrapper seller/customer/admin — Task 6/7/8.
- [x] Toaster customer mancante — Task 7.1.
- [x] Refetch session per propagare avatar — Task 6/7/8.
- [x] Test integration service-level — Task 1.
- [x] Verifica manuale end-to-end — Task 9.

**Placeholder scan**: nessuno. Tutti i code block sono completi. Le versioni delle dep al Task 0 si verificano con `bun pm view` (esplicitato).

**Type consistency**: `uploadUserAvatar` ritorna `{ key, url }` (Task 1.3) → consumato in Task 2.1 come `result.url` e `result.key`. `AvatarUploadDialogLabels` (Task 4.1) → nested in `PersonalInfoCardLabels.avatar` (Task 5.1) → fornito completo nei 3 wrapper (Task 6/7/8). Endpoint `api().me.avatar.post({ file })` (Task 6.1) → richiede che il body Elysia abbia campo `file` (Task 2.1) ✓.

Nessuna correzione necessaria.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-17-user-profile-image.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Spawn un subagent dedicato per ogni task, review tra un task e l'altro, iterazioni veloci.

**2. Inline Execution** — Eseguo i task in questa session usando `executing-plans`, con checkpoint di review batch.

**Quale preferisci?**
