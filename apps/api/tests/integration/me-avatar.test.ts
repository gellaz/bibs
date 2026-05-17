import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

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
	publicUrl: (key: string) => `http://minio/test-bucket/${key}`,
}));

// env mock: ci serve S3_ENDPOINT e S3_BUCKET per extractOurKey
mock.module("@/lib/env", () => ({
	env: {
		S3_ENDPOINT: "http://minio",
		S3_BUCKET: "test-bucket",
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
		expect(result.url).toBe(`http://minio/test-bucket/${key}`);
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
			.set({ image: `http://minio/test-bucket/${oldKey}` })
			.where(eq(userTable.id, user.id));

		await uploadUserAvatar({ userId: user.id, file: makeTestImageFile() });

		// best-effort cleanup: give the microtask queue a tick
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
		// best-effort cleanup: give the microtask queue a tick
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
			.set({ image: `http://minio/test-bucket/${key}` })
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
