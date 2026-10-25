import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { user } from "@/db/schemas/auth";
import { getTestDb } from "./test-db";

// Harness dei test delle sub-app Hono (D13 del piano Hono), al posto delle
// mini app Elysia copiate (`noopPino` + `errorHandler` + resolve finto).

/** Una richiesta alla sub-app, con path relativo come in `app.handle()` dei test Elysia. */
export function testRequest(
	app: Hono<any, any, any>,
	path: string,
	init?: RequestInit,
): Promise<Response> {
	return Promise.resolve(app.request(`http://localhost${path}`, init));
}

/**
 * Utente vero con sessione better-auth sul DB di test, per le route con
 * `requireAuth`: il cookie va nell'header `cookie`. `requireAuth` sta dentro
 * ogni route, quindi niente utente finto da header: la sessione è quella vera.
 * Chiamare dopo `mock.module("@/db")` (e di `@/lib/email`): better-auth si
 * importa qui dentro, come negli altri test.
 */
export async function signIn(email: string, role = "customer") {
	const { auth } = await import("@/lib/auth");
	const password = "password123";
	await auth.api.signUpEmail({ body: { name: "Test", email, password } });
	await getTestDb()
		.update(user)
		.set({ emailVerified: true, role })
		.where(eq(user.email, email));
	const res = await auth.api.signInEmail({
		body: { email, password },
		asResponse: true,
	});
	const [row] = await getTestDb()
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email));
	return {
		userId: row.id,
		cookie: res.headers
			.getSetCookie()
			.map((c) => c.split(";")[0])
			.join("; "),
	};
}
