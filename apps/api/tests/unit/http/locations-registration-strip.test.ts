import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { __clearRateLimitStores } from "@/http/middleware/rate-limit";
import { locationsApp } from "@/modules/locations";
import * as geocode from "@/modules/locations/services/geocode";
import * as locations from "@/modules/locations/services/locations";
import { registrationApp } from "@/modules/registration";
import * as registration from "@/modules/registration/services/registration";
import { testRequest, withVars } from "../../helpers/hono-app";

// Trappola `normalize` (D4 del piano Hono) sulle route vere di /locations e
// /register: un campo sconosciuto, anche annidato, nella query o nel body non
// arriva al servizio, e un campo in più restituito dal servizio (una colonna
// interna) non esce nella risposta. I servizi sono spiati per questo test e
// ripristinati dopo ognuno (niente mock.module né mock.restore(): sono globali
// tra i file).

const spies: { mockRestore(): void }[] = [];
const track = <S extends { mockRestore(): void }>(spy: S) => {
	spies.push(spy);
	return spy;
};

afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
	__clearRateLimitStores();
});

describe("/locations: strip in ingresso e in uscita", () => {
	it("GET /geocode: query senza campi ignoti, suggerimenti senza extra", async () => {
		const spy = track(spyOn(geocode, "geocodeAddress")).mockResolvedValue([
			{
				label: "Via Roma 1, Milano (MI)",
				addressLine1: "Via Roma 1",
				zipCode: "20121",
				location: { x: 9.19, y: 45.46, z: 0 },
				municipality: null,
				municipalityCandidates: [],
				providerRef: "osm:1",
				raw: { internal: "segreto" },
			} as never,
		]);
		const res = await testRequest(
			withVars(locationsApp, { user: { id: "u1" } }),
			"/geocode?q=Via%20Roma&extra=1&nested%5Ba%5D=1",
		);
		expect(res.status).toBe(200);
		expect(spy).toHaveBeenCalledWith({ q: "Via Roma", limit: 5 });
		expect(await res.json()).toEqual({
			success: true,
			data: [
				{
					label: "Via Roma 1, Milano (MI)",
					addressLine1: "Via Roma 1",
					zipCode: "20121",
					location: { x: 9.19, y: 45.46 },
					municipality: null,
					municipalityCandidates: [],
					providerRef: "osm:1",
				},
			],
		});
	});

	it("GET /municipalities/all: righe senza colonne interne", async () => {
		track(spyOn(locations, "listAllMunicipalities")).mockResolvedValue([
			{
				id: "m1",
				name: "Milano",
				provinceAcronym: "MI",
				istatCode: "015146",
			} as never,
		]);
		const res = await testRequest(locationsApp, "/municipalities/all");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			data: [{ id: "m1", name: "Milano", provinceAcronym: "MI" }],
		});
	});
});

describe("/register: strip in ingresso e in uscita", () => {
	const now = new Date("2026-01-02T03:04:05.000Z");
	const user = {
		id: "u1",
		name: "mario",
		email: "mario@example.it",
		emailVerified: false,
		image: null,
		createdAt: now,
		updatedAt: now,
		role: "customer",
		banned: null,
		banReason: null,
		banExpires: null,
	};

	it("POST /customer: body senza campi ignoti, utente senza colonne interne", async () => {
		const spy = track(
			spyOn(registration, "registerCustomer"),
		).mockResolvedValue({
			user: { ...user, firstName: null, birthDate: null },
			profile: {
				id: "c1",
				userId: "u1",
				points: 0,
				createdAt: now,
				updatedAt: now,
			},
			token: null,
		} as never);
		const res = await testRequest(registrationApp, "/customer", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "mario@example.it",
				password: "password123",
				role: "admin",
				nested: { internal: true },
			}),
		});
		expect(res.status).toBe(200);
		expect(spy.mock.calls[0][0]).toEqual({
			email: "mario@example.it",
			password: "password123",
		});
		const body = await res.json();
		expect(Object.keys(body.data.user).sort()).toEqual(
			Object.keys(user).sort(),
		);
		expect(Object.keys(body.data.profile).sort()).toEqual([
			"createdAt",
			"id",
			"points",
			"userId",
		]);
	});

	it("POST /accept-invite: body senza campi ignoti, risposta senza extra", async () => {
		const spy = track(spyOn(registration, "acceptInvite")).mockResolvedValue({
			message: "Invito accettato",
			userId: "u2",
		} as never);
		const res = await testRequest(registrationApp, "/accept-invite", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				token: "t1",
				password: "password123",
				confirmPassword: "password123",
				storeIds: ["s1"],
			}),
		});
		expect(res.status).toBe(200);
		expect(spy.mock.calls[0][0]).toEqual({
			token: "t1",
			password: "password123",
		});
		expect(await res.json()).toEqual({
			success: true,
			data: null,
			message: "Invito accettato",
		});
	});
});
