import { afterEach, describe, expect, it } from "bun:test";
import { ServiceError } from "@/lib/errors";
import { photonProvider } from "@/lib/geocoding/photon";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

/** Cattura l'URL chiamato e risponde con `body`. */
function stubFetch(body: unknown, init: { ok?: boolean } = {}) {
	const calls: string[] = [];
	globalThis.fetch = (async (input: string | URL | Request) => {
		calls.push(String(input));
		return {
			ok: init.ok ?? true,
			json: async () => body,
		} as Response;
	}) as unknown as typeof fetch;
	return calls;
}

function feature(props: Record<string, unknown>, coords: [number, number]) {
	return { properties: props, geometry: { coordinates: coords } };
}

describe("photonProvider.search", () => {
	it("sends q and limit, and no lang (Photon rejects `it`)", async () => {
		const calls = stubFetch({ features: [] });

		await photonProvider.search("via roma 12", { limit: 5 });

		expect(calls).toHaveLength(1);
		const url = new URL(calls[0]);
		expect(url.searchParams.get("q")).toBe("via roma 12");
		expect(url.searchParams.get("limit")).toBe("5");
		expect(url.searchParams.get("lang")).toBeNull();
		expect(url.searchParams.get("lat")).toBeNull();
	});

	it("sends the proximity bias as lat/lon", async () => {
		const calls = stubFetch({ features: [] });

		await photonProvider.search("via roma 12", {
			limit: 5,
			near: { lat: 45.4642, lng: 9.19 },
		});

		const url = new URL(calls[0]);
		expect(url.searchParams.get("lat")).toBe("45.4642");
		expect(url.searchParams.get("lon")).toBe("9.19");
	});

	it("maps a feature into our hit shape", async () => {
		stubFetch({
			features: [
				feature(
					{
						street: "Via Roma",
						housenumber: "12",
						city: "Pioltello",
						county: "Milano",
						postcode: "20096",
						countrycode: "IT",
						osm_type: "N",
						osm_id: 7137139871,
					},
					[9.3278473, 45.4998571],
				),
			],
		});

		const hits = await photonProvider.search("via roma 12", { limit: 5 });

		expect(hits).toEqual([
			{
				addressLine1: "Via Roma 12",
				zipCode: "20096",
				location: { x: 9.3278473, y: 45.4998571 },
				rawCity: "Pioltello",
				rawCounty: "Milano",
				providerRef: "photon:N7137139871",
			},
		]);
	});

	it("drops results outside Italy", async () => {
		stubFetch({
			features: [
				feature(
					{ street: "Rue de Rome", city: "Paris", countrycode: "FR" },
					[2.35, 48.85],
				),
			],
		});

		expect(await photonProvider.search("rue de rome", { limit: 5 })).toEqual(
			[],
		);
	});

	it("keeps a street without a housenumber and a missing postcode as null", async () => {
		stubFetch({
			features: [
				feature(
					{
						street: "Via Roma",
						city: "Usseglio",
						county: "Torino",
						countrycode: "IT",
						osm_type: "W",
						osm_id: 42,
					},
					[7.223, 45.232],
				),
			],
		});

		const hits = await photonProvider.search("via roma", { limit: 5 });

		expect(hits[0].addressLine1).toBe("Via Roma");
		expect(hits[0].zipCode).toBeNull();
	});

	it("throws a 503 ServiceError when the provider answers with an error", async () => {
		stubFetch({}, { ok: false });

		await expect(
			photonProvider.search("via roma 12", { limit: 5 }),
		).rejects.toThrow(ServiceError);
	});

	it("throws a 503 ServiceError when the request fails or times out", async () => {
		globalThis.fetch = (async () => {
			throw new Error("The operation timed out.");
		}) as unknown as typeof fetch;

		const error = await photonProvider
			.search("via roma 12", { limit: 5 })
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ServiceError);
		expect((error as ServiceError).status).toBe(503);
	});
});
