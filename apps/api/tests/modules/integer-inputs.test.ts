import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { ordersRoutes } from "@/modules/customer/routes/orders";
import { locationsRoutes } from "@/modules/locations/routes/locations";
import { brandsRoutes } from "@/modules/seller/routes/brands";
import { imagesRoutes } from "@/modules/seller/routes/images";
import { stockRoutes } from "@/modules/seller/routes/stock";
import { storeImagesRoutes } from "@/modules/seller/routes/store-images";
import { storesRoutes } from "@/modules/seller/routes/stores";
import { errorHandler } from "@/plugins/error-handler";

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

// Mounted bare: validation runs before any guard or handler, so a fractional
// value in an integer field must come back as a 422, never reach the DB
// (22P02 → 500). Everything else in each request is valid on purpose.
const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.use(stockRoutes)
	.use(storesRoutes)
	.use(imagesRoutes)
	.use(storeImagesRoutes)
	.use(brandsRoutes)
	.use(locationsRoutes)
	.use(ordersRoutes);

function json(method: string, path: string, body: unknown) {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method,
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
		}),
	);
}

function get(path: string) {
	return app.handle(new Request(`http://localhost${path}`));
}

// 1×1 PNG: a real image, so the multipart `files` field passes t.Files.
const PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	),
	(c) => c.charCodeAt(0),
);

function multipart(path: string, position: string) {
	const form = new FormData();
	form.append("files", new File([PNG], "a.png", { type: "image/png" }));
	form.append("position", position);
	return app.handle(
		new Request(`http://localhost${path}`, { method: "POST", body: form }),
	);
}

const STORE_BODY = {
	name: "Pasticceria Test",
	addressLine1: "Via Roma 1",
	municipalityId: "00000000-0000-0000-0000-000000000001",
	zipCode: "20100",
};

const ORDER_BODY = {
	type: "pay_pickup",
	storeId: "some-store",
	items: [{ storeProductId: "some-sp", quantity: 1 }],
};

describe("integer inputs reject fractions with 422", () => {
	const fractional: Array<[string, () => Promise<Response>]> = [
		[
			"PATCH stock",
			() => json("PATCH", "/products/p/stores/s", { stock: 1.5 }),
		],
		[
			"POST link stores stock",
			() => json("POST", "/products/p/stores", { storeIds: ["s"], stock: 2.5 }),
		],
		[
			"POST /stores phone position",
			() =>
				json("POST", "/stores", {
					...STORE_BODY,
					phoneNumbers: [{ number: "0512345678", position: 0.5 }],
				}),
		],
		[
			"PATCH /stores/:id phone position",
			() =>
				json("PATCH", "/stores/s", {
					phoneNumbers: [{ number: "0512345678", position: 0.5 }],
				}),
		],
		[
			"POST product image position",
			() => multipart("/products/p/images", "1.5"),
		],
		["POST store image position", () => multipart("/stores/s/images", "1.5")],
		["GET /brands limit", () => get("/brands?limit=2.5")],
		["GET /brands page", () => get("/brands?page=1.5")],
		["GET /geocode limit", () => get("/geocode?q=Via%20Roma&limit=2.5")],
		[
			"POST /orders quantity",
			() =>
				json("POST", "/orders", {
					...ORDER_BODY,
					items: [{ storeProductId: "some-sp", quantity: 1.5 }],
				}),
		],
		[
			"POST /orders pointsToSpend",
			() => json("POST", "/orders", { ...ORDER_BODY, pointsToSpend: 0.5 }),
		],
	];

	for (const [label, send] of fractional) {
		it(`${label} → 422`, async () => {
			const res = await send();
			expect(res.status).toBe(422);
		});
	}
});

describe("integer inputs still accept whole numbers", () => {
	const whole: Array<[string, () => Promise<Response>]> = [
		[
			"POST product image position '2' (multipart string)",
			() => multipart("/products/p/images", "2"),
		],
		["POST /orders quantity 1", () => json("POST", "/orders", ORDER_BODY)],
		[
			"POST /orders pointsToSpend 0",
			() => json("POST", "/orders", { ...ORDER_BODY, pointsToSpend: 0 }),
		],
	];

	for (const [label, send] of whole) {
		it(`${label} → passes validation`, async () => {
			const res = await send();
			expect(res.status).not.toBe(422);
		});
	}
});
