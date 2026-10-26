import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { sellerApp } from "@/modules/seller";
import * as billing from "@/modules/seller/services/billing";
import * as checkout from "@/modules/seller/services/checkout";
import * as discounts from "@/modules/seller/services/discounts";
import * as orders from "@/modules/seller/services/orders";
import { testRequest, withVars } from "../helpers/hono-app";

// Trappola `normalize` (D4 del piano Hono) sulle route vere di U7 (promozioni,
// ordini, billing, checkout): un campo sconosciuto, anche annidato, nella
// query o nel body non arriva al servizio, e un campo in più restituito dal
// servizio (una colonna interna) non esce nella risposta. I servizi sono
// spiati e ripristinati dopo ogni test (niente mock.module: è globale).

const spies: { mockRestore(): void }[] = [];
const track = <S extends { mockRestore(): void }>(spy: S) => {
	spies.push(spy);
	return spy;
};
afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
});

const at = new Date("2026-01-02T03:04:05.000Z");
const iso = at.toISOString();

const app = withVars(sellerApp, {
	user: { id: "u1" },
	seller: {
		isOwner: true,
		sellerProfile: { id: "sp1", onboardingStatus: "active" },
		accessCtx: { userId: "u1", sellerProfileId: "sp1", isOwner: true },
		getAccessibleStoreIds: async () => ["s1"],
	},
});
const json = (method: string, body: unknown) => ({
	method,
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
});

const discount = {
	id: "d1",
	sellerProfileId: "sp1",
	title: "Saldi",
	percent: 20,
	startsAt: at,
	endsAt: null,
	status: "active",
	createdAt: at,
	updatedAt: at,
};
const discountOut = {
	...discount,
	startsAt: iso,
	createdAt: iso,
	updatedAt: iso,
};

describe("promozioni: strip in ingresso e in uscita", () => {
	it("POST /discounts: body senza campi ignoti, promozione senza colonne interne", async () => {
		const create = track(spyOn(discounts, "createDiscount")).mockResolvedValue({
			...discount,
			internal: "segreto",
		} as never);
		const add = track(
			spyOn(discounts, "addProductsToDiscount"),
		).mockResolvedValue({ added: 1, alreadyPresent: 0, rejected: [] });
		const res = await testRequest(
			app,
			"/discounts",
			json("POST", {
				title: "Saldi",
				percent: 20,
				startsAt: iso,
				initialProductIds: ["p1"],
				status: "archived",
				sellerProfileId: "altro",
				nested: { a: 1 },
			}),
		);
		expect(res.status).toBe(200);
		expect(create).toHaveBeenCalledWith({
			sellerProfileId: "sp1",
			title: "Saldi",
			percent: 20,
			startsAt: at,
			endsAt: null,
		});
		expect(add).toHaveBeenCalledWith({
			discountId: "d1",
			sellerProfileId: "sp1",
			productIds: ["p1"],
		});
		expect(await res.json()).toEqual({ success: true, data: discountOut });
	});

	it("GET /discounts e PATCH: query e patch senza campi ignoti, righe senza extra", async () => {
		const list = track(spyOn(discounts, "listDiscounts")).mockResolvedValue({
			data: [{ ...discount, productCount: 2, sellerEmail: "x@y.it" }],
			pagination: { page: 1, limit: 5, total: 1, pages: 1 },
		} as never);
		const listed = await testRequest(
			app,
			"/discounts?state=assignable&limit=5&sellerProfileId=altro&nested%5Ba%5D=1",
		);
		expect(listed.status).toBe(200);
		expect(list).toHaveBeenCalledWith({
			sellerProfileId: "sp1",
			page: 1,
			limit: 5,
			state: "assignable",
			search: undefined,
		});
		expect(await listed.json()).toEqual({
			success: true,
			data: [{ ...discountOut, productCount: 2 }],
			pagination: { page: 1, limit: 5, total: 1 },
		});

		const update = track(spyOn(discounts, "updateDiscount")).mockResolvedValue(
			discount as never,
		);
		const patched = await testRequest(
			app,
			"/discounts/d1",
			json("PATCH", { title: "Nuovo", status: "archived", nested: { a: 1 } }),
		);
		expect(patched.status).toBe(200);
		expect(update).toHaveBeenCalledWith({
			discountId: "d1",
			sellerProfileId: "sp1",
			patch: { title: "Nuovo" },
		});
	});
});

describe("ordini, billing, checkout: strip", () => {
	it("GET /orders/:id: niente colonne interne, né dati di account del cliente", async () => {
		const order = {
			id: "o1",
			customerProfileId: "c1",
			storeId: "s1",
			type: "reserve_pickup",
			status: "confirmed",
			total: "10.00",
			shippingAddressId: null,
			checkoutId: null,
			pickupCode: "K7XM4P",
			shippingAddressSnapshot: null,
			shippingCost: null,
			vatBreakdown: null,
			reservationExpiresAt: at,
			paymentExpiresAt: null,
			pointsEarned: 0,
			pointsSpent: 0,
			pointsDiscount: "0.00",
			createdAt: at,
			updatedAt: at,
		};
		const store = {
			id: "s1",
			sellerProfileId: "sp1",
			name: "Bottega",
			description: null,
			addressLine1: "Via Roma 1",
			addressLine2: null,
			municipalityId: "m1",
			municipality: { id: "m1", name: "Bologna", provinceAcronym: "BO" },
			zipCode: "40100",
			country: "IT",
			categoryId: null,
			openingHours: null,
			websiteUrl: null,
			createdAt: at,
			updatedAt: at,
		};
		track(spyOn(orders, "getSellerOrder")).mockResolvedValue({
			...order,
			stripePaymentIntentId: "pi_segreto",
			items: [],
			customerProfile: {
				id: "c1",
				points: 120,
				user: {
					id: "u2",
					name: "Mario",
					email: "mario@test.it",
					image: null,
					role: "customer",
					banned: true,
				},
			},
			store: { ...store, location: { x: 1, y: 2 }, deletedAt: null },
		} as never);
		const res = await testRequest(app, "/orders/o1");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.stripePaymentIntentId).toBeUndefined();
		expect(body.data.customerProfile).toEqual({
			id: "c1",
			user: { id: "u2", name: "Mario", email: "mario@test.it", image: null },
		});
		expect(Object.keys(body.data.store).sort()).toEqual(
			Object.keys(store).sort(),
		);
		expect(body.data.reservationExpiresAt).toBe(iso);
	});

	it("GET /billing/subscriptions: niente id Stripe in uscita", async () => {
		track(spyOn(billing, "listBillingSubscriptions")).mockResolvedValue([
			{
				storeId: "s1",
				storeName: "Bottega",
				status: "active",
				feeAmountCents: 1000,
				currency: "EUR",
				currentPeriodEnd: at,
				cancelAtPeriodEnd: false,
				suspendedAt: null,
				stripeSubscriptionId: "sub_segreto",
				stripeCustomerId: "cus_segreto",
			},
		] as never);
		const res = await testRequest(app, "/billing/subscriptions");
		expect(await res.json()).toEqual({
			success: true,
			data: [
				{
					storeId: "s1",
					storeName: "Bottega",
					status: "active",
					feeAmountCents: 1000,
					currency: "EUR",
					currentPeriodEnd: iso,
					cancelAtPeriodEnd: false,
					suspendedAt: null,
				},
			],
		});
	});

	it("POST /stores/checkout: il servizio riceve solo i campi del form", async () => {
		const create = track(
			spyOn(checkout, "createCheckoutSession"),
		).mockResolvedValue({
			checkoutUrl: "https://checkout.stripe.test/x",
			pendingStoreCreationId: "p1",
			stripeSessionId: "cs_segreto",
		} as never);
		const res = await testRequest(
			app,
			"/stores/checkout",
			json("POST", {
				name: "Bottega",
				addressLine1: "Via Roma 1",
				municipalityId: "m1",
				zipCode: "40100",
				location: { x: 11, y: 44, srid: 4326 },
				openingHours: [
					{
						dayOfWeek: 0,
						extra: 1,
						slots: [{ open: "09:00", close: "12:00", note: "x" }],
					},
				],
				phoneNumbers: [{ number: "051123456", primary: true }],
				sellerProfileId: "altro",
			}),
		);
		expect(res.status).toBe(200);
		expect(create).toHaveBeenCalledWith({
			sellerProfileId: "sp1",
			body: {
				name: "Bottega",
				addressLine1: "Via Roma 1",
				municipalityId: "m1",
				zipCode: "40100",
				location: { x: 11, y: 44 },
				openingHours: [
					{ dayOfWeek: 0, slots: [{ open: "09:00", close: "12:00" }] },
				],
				phoneNumbers: [{ number: "051123456" }],
			},
		});
		expect(await res.json()).toEqual({
			success: true,
			data: {
				checkoutUrl: "https://checkout.stripe.test/x",
				pendingStoreCreationId: "p1",
			},
		});
	});
});
