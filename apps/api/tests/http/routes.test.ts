import { describe, expect, it } from "bun:test";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { moduleApp } from "@/http/app";
import {
	requireAuth,
	requireCustomer,
	requireSeller,
	requireSellerRole,
} from "@/http/auth";
import { doc } from "@/http/openapi";
import { assertRoutes, guard, publicRoute, routeProblems } from "@/http/routes";
import { v } from "@/http/validator";
import { ServiceError } from "@/lib/errors";
import { customerApp } from "@/modules/customer";
import { meApp } from "@/modules/me";
import { sellerApp, sellerGuards } from "@/modules/seller";
import { withVars } from "../helpers/hono-app";

// Le route Hono hanno l'auth dentro ogni route (D9 del piano Hono): il
// controllo di `routes.ts` (a ogni avvio, da `honoPaths()`) ferma una route
// senza guardia, un v() dopo l'auth e i v() fuori dall'ordine di sempre.

const Body = z.object({ name: z.string() });
const Query = z.object({ q: z.string() });
const Param = z.object({ id: z.string() });
const ok = (c: { json: (b: unknown) => Response }) => c.json({ ok: true });

describe("routeProblems()", () => {
	it("il modulo me/ è a posto", () => {
		expect(routeProblems(meApp, ["auth"])).toEqual([]);
		expect(() => assertRoutes(meApp, ["auth"])).not.toThrow();
	});

	it("una route senza guardia né publicRoute è un errore", () => {
		const app = moduleApp().patch("/b/:id", v("json", Body), ok);
		expect(routeProblems(app, ["auth"])).toEqual([
			"PATCH /b/:id: né guardia di auth né publicRoute",
		]);
		expect(() => assertRoutes(app, ["auth"])).toThrow("Route Hono non valide");
	});

	it("publicRoute dichiara una route pubblica", () => {
		const app = moduleApp().get("/p", publicRoute, v("query", Query), ok);
		expect(routeProblems(app, ["publicRoute"])).toEqual([]);
	});

	it("il modulo customer/ è a posto: 8 route pubbliche, 17 con requireCustomer", () => {
		expect(routeProblems(customerApp, ["customer", "publicRoute"])).toEqual([]);
		expect(routeProblems(customerApp, ["customer"])).toHaveLength(8);
		expect(routeProblems(customerApp, ["publicRoute"])).toHaveLength(17);
	});

	it("publicRoute vale solo se il modulo la dichiara", () => {
		const app = moduleApp().get("/p", publicRoute, ok);
		expect(routeProblems(app, ["admin"])).toEqual([
			"GET /p: manca la guardia del modulo (admin)",
		]);
		expect(routeProblems(app, ["customer", "publicRoute"])).toEqual([]);
	});

	it("un v() dopo l'auth è un errore (422 prima di 401)", () => {
		const app = moduleApp().post("/x", requireAuth, v("json", Body), ok);
		expect(routeProblems(app, ["auth"])).toEqual([
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
		expect(routeProblems(bad, ["auth"])).toEqual([
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
		expect(routeProblems(good, ["auth"])).toEqual([]);
	});
});

describe("routeProblems(): guardia del modulo e handler davanti all'auth", () => {
	// Un middleware di ruolo come quelli delle unità seguenti (D9).
	const requireAdmin = guard(
		createMiddleware(async (c, next) => {
			if (c.var.user?.role !== "admin")
				throw new ServiceError(403, "Accesso riservato agli amministratori");
			await next();
		}),
		"admin",
	);

	it("una route admin con solo requireAuth è un errore", async () => {
		const adminApp = moduleApp()
			.delete("/product-categories/:id", requireAuth, requireAdmin, ok)
			.patch("/product-categories/:id", requireAuth, ok);
		expect(routeProblems(adminApp, ["admin"])).toEqual([
			"PATCH /product-categories/:id: manca la guardia del modulo (admin)",
		]);
		// Senza il controllo la route risponderebbe a un utente qualunque.
		const res = await withVars(adminApp, {
			user: { id: "u1", role: "user" },
		}).request("/product-categories/1", { method: "PATCH" });
		expect(res.status).toBe(200);
	});

	it("un modulo tutto pubblico accetta solo publicRoute", () => {
		const app = moduleApp()
			.get("/a", publicRoute, ok)
			.get("/b", requireAuth, ok);
		expect(routeProblems(app, ["publicRoute"])).toEqual([
			"GET /b: manca la guardia del modulo (publicRoute)",
		]);
	});

	it("una guardia già marcata non si rimarca", () => {
		expect(() => guard(requireAuth, "admin")).toThrow(
			'guard(): middleware già marcato "auth"',
		);
		expect(routeProblems(meApp, ["auth"])).toEqual([]);
	});

	it("una seconda registrazione dello stesso path non protegge la prima", async () => {
		const app = moduleApp()
			.get("/x", ok)
			.get("/x", requireAuth, (c) => c.json({ guarded: true }));
		expect(routeProblems(app, ["auth"])).toEqual([
			"GET /x: né guardia di auth né publicRoute",
		]);
		expect(await (await app.request("/x")).json()).toEqual({ ok: true });
	});

	it("la guardia del modulo vale solo prima del primo handler", () => {
		const app = moduleApp()
			.get("/x", requireAuth, ok)
			.get("/x", requireAdmin, ok);
		expect(routeProblems(app, ["admin"])).toEqual([
			"GET /x: manca la guardia del modulo (admin)",
		]);
	});

	it("un .all() senza * è una route e vuole la guardia", () => {
		const app = moduleApp().all("/thing", ok);
		expect(routeProblems(app, ["auth"])).toEqual([
			"ALL /thing: né guardia di auth né publicRoute",
		]);
	});

	it("use() su * e doc() davanti all'auth non sono problemi", () => {
		const app = moduleApp()
			.use("*", async (_c, next) => next())
			.get("/x", doc({}), v("query", Query), requireAuth, ok);
		expect(routeProblems(app, ["auth"])).toEqual([]);
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

	it("requireCustomer non rilegge sessione né profilo", async () => {
		const app = moduleApp().get("/who", requireCustomer, (c) =>
			c.json({ id: c.var.user.id, profile: c.var.customerProfile.id }),
		);
		const res = await withVars(app, {
			user: { id: "u1" },
			customerProfile: { id: "cp1" },
		}).request("/who");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: "u1", profile: "cp1" });
	});
});

// U5: le guardie del seller si controllano route per route (`sellerGuards`),
// e le guardie di ruolo leggono la sessione da sé (l'ordine non conta).
describe("guardie seller", () => {
	it("il modulo seller è a posto", () => {
		expect(routeProblems(sellerApp, sellerGuards)).toEqual([]);
		expect(() => assertRoutes(sellerApp, sellerGuards)).not.toThrow();
	});

	it("la guardia sbagliata per il path è un errore, nei due sensi", () => {
		const app = moduleApp()
			.get("/products", requireSellerRole, ok)
			.get("/profile", requireSeller, ok)
			.patch("/onboarding/company", requireSeller, ok)
			.get("/onboarding/status", requireSellerRole, ok)
			.get("/brands", requireAuth, ok);
		expect(routeProblems(app, sellerGuards)).toEqual([
			"GET /products: manca la guardia del modulo (seller)",
			"GET /profile: manca la guardia del modulo (sellerRole)",
			"PATCH /onboarding/company: manca la guardia del modulo (sellerRole)",
			"GET /brands: manca la guardia del modulo (seller)",
		]);
	});

	it("requireSeller senza requireAuth davanti: 401 per l'anonimo", async () => {
		const app = moduleApp().get("/x", requireSeller, ok);
		const res = await app.request("/x");
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			success: false,
			error: "UNAUTHORIZED",
			message: "Devi accedere per continuare",
		});
	});

	it("requireSeller: un ruolo non seller è 403, dopo i validatori", async () => {
		const app = moduleApp().get("/x", v("query", Query), requireSeller, ok);
		const customer = withVars(app, { user: { id: "u1", role: "customer" } });
		const res = await customer.request("/x?q=a");
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			success: false,
			error: "FORBIDDEN",
			message: "Accesso riservato a venditori e dipendenti",
		});
		expect((await customer.request("/x")).status).toBe(422);
	});

	it("requireSeller non rilegge c.var.seller messo a monte", async () => {
		const app = moduleApp().get("/x", requireSeller, (c) =>
			c.json({ profile: c.var.seller.sellerProfile.id }),
		);
		const res = await withVars(app, {
			user: { id: "u1", role: "seller" },
			seller: { sellerProfile: { id: "sp1" }, isOwner: true },
		}).request("/x");
		expect(await res.json()).toEqual({ profile: "sp1" });
	});

	// U6: profilo e onboarding (ruolo seller, partita IVA non ancora verificata).
	it("requireSellerRole: 401 per l'anonimo, 403 per chi non è seller, dopo i validatori", async () => {
		const app = moduleApp().get(
			"/onboarding/x",
			v("query", Query),
			requireSellerRole,
			(c) => c.json({ id: c.var.user.id }),
		);
		const anonymous = await app.request("/onboarding/x?q=a");
		expect(anonymous.status).toBe(401);
		expect(await anonymous.json()).toEqual({
			success: false,
			error: "UNAUTHORIZED",
			message: "Devi accedere per continuare",
		});
		for (const role of ["customer", "employee", null]) {
			const other = withVars(app, { user: { id: "u1", role } });
			const res = await other.request("/onboarding/x?q=a");
			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({
				success: false,
				error: "FORBIDDEN",
				message: "Accesso riservato ai venditori",
			});
			expect((await other.request("/onboarding/x")).status).toBe(422);
		}
		const seller = withVars(app, { user: { id: "u1", role: "seller" } });
		expect(await (await seller.request("/onboarding/x?q=a")).json()).toEqual({
			id: "u1",
		});
	});
});
