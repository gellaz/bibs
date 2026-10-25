import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { moduleApp } from "@/http/app";
import { requireAuth } from "@/http/auth";
import { assertRoutes, publicRoute, routeProblems } from "@/http/routes";
import { v } from "@/http/validator";
import { meApp } from "@/modules/me";
import { withVars } from "../helpers/hono-app";

// Le route Hono hanno l'auth dentro ogni route (D9 del piano Hono): il
// controllo di `routes.ts` (a ogni avvio, da `honoPaths()`) ferma una route
// senza guardia, un v() dopo l'auth e i v() fuori dall'ordine di Elysia.

const Body = z.object({ name: z.string() });
const Query = z.object({ q: z.string() });
const Param = z.object({ id: z.string() });
const ok = (c: { json: (b: unknown) => Response }) => c.json({ ok: true });

describe("routeProblems()", () => {
	it("il modulo me/ è a posto", () => {
		expect(routeProblems(meApp)).toEqual([]);
		expect(() => assertRoutes(meApp)).not.toThrow();
	});

	it("una route senza guardia né publicRoute è un errore", () => {
		const app = moduleApp().patch("/b/:id", v("json", Body), ok);
		expect(routeProblems(app)).toEqual([
			"PATCH /b/:id: né guardia di auth né publicRoute",
		]);
		expect(() => assertRoutes(app)).toThrow("Route Hono non valide");
	});

	it("publicRoute dichiara una route pubblica", () => {
		const app = moduleApp().get("/p", publicRoute, v("query", Query), ok);
		expect(routeProblems(app)).toEqual([]);
	});

	it("un v() dopo l'auth è un errore (422 prima di 401)", () => {
		const app = moduleApp().post("/x", requireAuth, v("json", Body), ok);
		expect(routeProblems(app)).toEqual([
			"POST /x: un v() dopo l'auth (422 prima di 401)",
		]);
	});

	it("i v() vanno in ordine params, query, body", () => {
		const bad = moduleApp().post(
			"/x/:id",
			v("json", Body),
			v("query", Query),
			v("param", Param),
			requireAuth,
			ok,
		);
		expect(routeProblems(bad)).toEqual([
			"POST /x/:id: v() fuori ordine (params, query, body)",
		]);
		const good = moduleApp().post(
			"/x/:id",
			v("param", Param),
			v("query", Query),
			v("json", Body),
			requireAuth,
			ok,
		);
		expect(routeProblems(good)).toEqual([]);
	});
});

describe("requireAuth con l'utente già messo a monte (harness dei test)", () => {
	it("non rilegge la sessione", async () => {
		const app = moduleApp().get("/who", requireAuth, (c) =>
			c.json({ id: c.var.user.id }),
		);
		const res = await withVars(app, { user: { id: "u1" } }).request("/who");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: "u1" });
	});
});
