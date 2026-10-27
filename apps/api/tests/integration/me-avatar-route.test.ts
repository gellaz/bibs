import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
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
mock.module("@/infra/email", () => ({ sendEmail: async () => {} }));

const s3WriteMock = mock(async (_key: string, _data: Buffer) => {});
const s3DeleteMock = mock(async (_key: string) => {});
mock.module("@/infra/s3", () => ({
	s3: { write: s3WriteMock, delete: s3DeleteMock },
	publicUrl: (key: string) => `http://localhost:9000/bibs-test/${key}`,
}));

import { eq } from "drizzle-orm";
import { user as userTable } from "@/db/schemas/auth";
import { send } from "@/http/send";
import { validate } from "@/http/validator";
import { truncateAll } from "../helpers/cleanup";
import { signIn, testRequest } from "../helpers/hono-app";

// Le route di /me sulla sub-app Hono (con la sua fabbrica, da sola):
// risposte catturate prima della migrazione
// (`baseline/hono-batch-me.jsonl`) e strip in ingresso e in uscita.

let meApp: typeof import("@/modules/me").meApp;
let avatar: typeof import("@/modules/me/routes/avatar");

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);

const form = (file: File, extra: Record<string, string> = {}) => {
	const body = new FormData();
	body.append("file", file);
	for (const [key, value] of Object.entries(extra)) body.append(key, value);
	return body;
};

beforeAll(async () => {
	await setupTestContainer();
	// dinamici: @/lib/auth cattura `db` alla valutazione
	({ meApp } = await import("@/modules/me"));
	avatar = await import("@/modules/me/routes/avatar");
}, 180_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	s3WriteMock.mockClear();
	s3DeleteMock.mockClear();
});

describe("/me/avatar su Hono", () => {
	it("senza sessione: 401 su DELETE e su POST con un'immagine valida", async () => {
		const unauthorized = {
			success: false,
			error: "UNAUTHORIZED",
			message: "Devi accedere per continuare",
		};
		const del = await testRequest(meApp, "/avatar", { method: "DELETE" });
		expect(del.status).toBe(401);
		expect(await del.json()).toEqual(unauthorized);
		const post = await testRequest(meApp, "/avatar", {
			method: "POST",
			body: form(new File([PNG], "a.png", { type: "image/png" })),
		});
		expect(post.status).toBe(401);
		expect(await post.json()).toEqual(unauthorized);
	});

	it("file non immagine: lo stesso 422 di prima, anche prima del login", async () => {
		const { cookie } = await signIn("me-422@test.com");
		const anonymousThenSignedIn: Record<string, string>[] = [{}, { cookie }];
		for (const headers of anonymousThenSignedIn) {
			const res = await testRequest(meApp, "/avatar", {
				method: "POST",
				headers,
				body: form(new File(["hello"], "a.txt", { type: "text/plain" })),
			});
			expect(res.status).toBe(422);
			expect(await res.json()).toEqual({
				success: false,
				error: "VALIDATION_ERROR",
				message: "File: tipo di file non ammesso",
			});
		}
		expect(s3WriteMock).not.toHaveBeenCalled();
	});

	it("upload valido: 200 con la URL, user.image aggiornato", async () => {
		const { userId, cookie } = await signIn("me-ok@test.com");
		const res = await testRequest(meApp, "/avatar", {
			method: "POST",
			headers: { cookie },
			body: form(new File([PNG], "a.png", { type: "image/png" }), {
				userId: "someone-else",
				extra: "x",
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Object.keys(body)).toEqual(["success", "data"]);
		expect(Object.keys(body.data)).toEqual(["image"]);
		expect(body.data.image).toMatch(
			new RegExp(`^http://localhost:9000/bibs-test/users/${userId}/`),
		);
		const [row] = await getTestDb()
			.select({ image: userTable.image })
			.from(userTable)
			.where(eq(userTable.id, userId));
		expect(row.image).toBe(body.data.image);
		expect(s3WriteMock).toHaveBeenCalledTimes(1);
	});

	it("DELETE con sessione: 200 «Avatar rimosso»", async () => {
		const { cookie } = await signIn("me-del@test.com");
		const res = await testRequest(meApp, "/avatar", {
			method: "DELETE",
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			data: null,
			message: "Avatar rimosso",
		});
	});
});

describe("/me/avatar: strip (trappola normalize)", () => {
	it("i campi in più del form non arrivano all'handler", async () => {
		const file = new File([PNG], "a.png", { type: "image/png" });
		const value = await validate("form", avatar.AvatarBody, {
			file,
			userId: "someone-else",
			nested: { internal: true },
		});
		expect(Object.keys(value)).toEqual(["file"]);
	});

	it("i campi in più della risposta non escono", async () => {
		const app = (await import("@/http/app")).moduleApp().get("/", (c) =>
			send(c, avatar.AvatarResponse, {
				success: true,
				data: { image: "u", key: "users/1/x.jpg" },
				internal: 1,
			} as never),
		);
		expect(await (await app.request("/")).text()).toBe(
			'{"success":true,"data":{"image":"u"}}',
		);
	});
});
