import { afterEach, describe, expect, it, mock } from "bun:test";

// The route is a thin adapter over the dispatcher; mock the dispatcher so we can
// drive each branch (success / signature error / handler failure) deterministically
// without a database or real Stripe verification.
const handleStripeWebhook = mock(async () => {});
mock.module("@/modules/webhooks/services/dispatcher", () => ({
	handleStripeWebhook,
}));

import { webhooksApp } from "@/modules/webhooks";
import { testRequest } from "../helpers/hono-app";

function post(
	body: string,
	headers: Record<string, string> = { "stripe-signature": "sig" },
	path = "/webhooks/stripe",
): Promise<Response> {
	// La sub-app è montata su /webhooks (`src/index.ts`): vede il path senza prefisso.
	return testRequest(webhooksApp, path.replace(/^\/webhooks/, ""), {
		method: "POST",
		headers,
		body,
	});
}

afterEach(() => {
	handleStripeWebhook.mockClear();
});

describe("POST /webhooks/stripe status codes", () => {
	it("returns 400 when the stripe-signature header is missing", async () => {
		const res = await post("raw", {});
		expect(res.status).toBe(400);
	});

	it("returns 400 on signature verification failure", async () => {
		handleStripeWebhook.mockImplementationOnce(async () => {
			throw new Error("Invalid Stripe signature");
		});
		const res = await post("raw");
		expect(res.status).toBe(400);
	});

	it("returns 500 on handler failure so Stripe retries (does not swallow as 200)", async () => {
		handleStripeWebhook.mockImplementationOnce(async () => {
			throw new Error("db connection lost mid-handler");
		});
		const res = await post("raw");
		expect(res.status).toBe(500);
	});

	it("returns 200 on successful processing", async () => {
		const res = await post("raw");
		expect(res.status).toBe(200);
	});
});

describe("POST /webhooks/stripe/connect status codes", () => {
	it("returns 400 when the stripe-signature header is missing", async () => {
		const res = await post("raw", {}, "/webhooks/stripe/connect");
		expect(res.status).toBe(400);
	});

	it("returns 400 on signature verification failure", async () => {
		handleStripeWebhook.mockImplementationOnce(async () => {
			throw new Error("Invalid Stripe signature");
		});
		const res = await post(
			"raw",
			{ "stripe-signature": "sig" },
			"/webhooks/stripe/connect",
		);
		expect(res.status).toBe(400);
	});

	it("returns 500 on handler failure so Stripe retries (does not swallow as 200)", async () => {
		handleStripeWebhook.mockImplementationOnce(async () => {
			throw new Error("db connection lost mid-handler");
		});
		const res = await post(
			"raw",
			{ "stripe-signature": "sig" },
			"/webhooks/stripe/connect",
		);
		expect(res.status).toBe(500);
	});

	it("returns 200 on successful processing", async () => {
		const res = await post(
			"raw",
			{ "stripe-signature": "sig" },
			"/webhooks/stripe/connect",
		);
		expect(res.status).toBe(200);
	});
});

describe("POST /webhooks/stripe/thin status codes", () => {
	it("returns 400 when the stripe-signature header is missing", async () => {
		const res = await post("raw", {}, "/webhooks/stripe/thin");
		expect(res.status).toBe(400);
	});

	it("returns 500 on handler failure so Stripe retries", async () => {
		handleStripeWebhook.mockImplementationOnce(async () => {
			throw new Error("db connection lost mid-handler");
		});
		const res = await post(
			"raw",
			{ "stripe-signature": "sig" },
			"/webhooks/stripe/thin",
		);
		expect(res.status).toBe(500);
	});
});

describe("dispatcher scope", () => {
	it("la route thin passa scope: 'thin' al dispatcher", async () => {
		await post("raw", { "stripe-signature": "sig" }, "/webhooks/stripe/thin");
		expect(handleStripeWebhook).toHaveBeenCalledWith({
			payload: "raw",
			signature: "sig",
			scope: "thin",
		});
	});

	it("la route connect passa scope: 'connect' al dispatcher", async () => {
		await post(
			"raw",
			{ "stripe-signature": "sig" },
			"/webhooks/stripe/connect",
		);
		expect(handleStripeWebhook).toHaveBeenCalledWith({
			payload: "raw",
			signature: "sig",
			scope: "connect",
		});
	});

	it("la route piattaforma passa scope: 'platform'", async () => {
		await post("raw");
		expect(handleStripeWebhook).toHaveBeenCalledWith({
			payload: "raw",
			signature: "sig",
			scope: "platform",
		});
	});
});

// Il «test di strip» del modulo (piano Hono, Verifica di ogni PR). Qui il
// contratto è rovesciato: la firma Stripe copre i byte esatti, quindi in
// ingresso niente strip né trim (campi ignoti annidati compresi); in uscita
// solo i corpi fissi della route, niente di ciò che arriva dal servizio.
describe("webhook su Hono: body grezzo in ingresso, corpi fissi in uscita", () => {
	const raw =
		'{\n  "id" : "evt_1",\n  "type":"x",  "data": { "object": { "ignoto": { "annidato": "  spazi  è " } } },\n  "extra": [1, 2] }\n';

	it("il payload arriva al dispatcher identico al byte, anche JSON con campi ignoti", async () => {
		const res = await post(raw, {
			"stripe-signature": "sig",
			"content-type": "application/json",
		});
		expect(res.status).toBe(200);
		expect(handleStripeWebhook).toHaveBeenCalledWith({
			payload: raw,
			signature: "sig",
			scope: "platform",
		});

		// Come la Request che ricostruisce il mount di Elysia: un BOM UTF-16LE
		// resta byte da decodificare in UTF-8, come `request.text()` di prima.
		const bom = new Uint8Array([0xff, 0xfe, 0x41, 0x00]);
		const original = new Request("http://localhost/stripe", {
			method: "POST",
			headers: { "stripe-signature": "sig" },
			body: bom,
		});
		await webhooksApp.request(new Request(original.url, original));
		expect(handleStripeWebhook).toHaveBeenLastCalledWith({
			payload: new TextDecoder().decode(bom),
			signature: "sig",
			scope: "platform",
		});
	});

	it("le risposte sono solo i corpi fissi, col Content-Type di Elysia", async () => {
		const ok = await post(raw);
		expect(ok.headers.get("content-type")).toBe(
			"application/json;charset=utf-8",
		);
		expect(await ok.text()).toBe('{"received":true}');

		handleStripeWebhook.mockImplementationOnce(async () => {
			throw Object.assign(new Error("Invalid signature for cus_123"), {
				stripeCustomerId: "cus_123",
			});
		});
		const invalid = await post(raw);
		expect(invalid.status).toBe(400);
		expect(await invalid.text()).toBe('{"error":"invalid signature"}');

		handleStripeWebhook.mockImplementationOnce(async () => {
			throw Object.assign(new Error("db down: password=hunter2"), {
				internal: true,
			});
		});
		const failed = await post(raw);
		expect(failed.status).toBe(500);
		expect(await failed.text()).toBe('{"error":"internal error"}');

		const missing = await post(raw, {});
		expect(missing.status).toBe(400);
		expect(await missing.text()).toBe('{"error":"missing signature"}');
	});
});
