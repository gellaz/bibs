import type { InferResponseType } from "hono/client";
import type { Coords } from "@/features/location/coords";
import { customerApi } from "@/lib/api";

const detail = customerApi.products[":id"].$get;
export type ProductDetailView = InferResponseType<typeof detail, 200>["data"];
export type ProductCharacteristicView =
	ProductDetailView["characteristics"][number];

/**
 * La scheda di un prodotto, `null` se non è visibile (404). Le
 * caratteristiche di testo che somigliano a una data («05/03/2027») restano
 * testo: `hc` non le trasforma in `Date` (vedi C8 nel piano PR 5).
 */
export async function fetchProductDetail(
	productId: string,
	params: { storeId?: string; coords: Coords | null },
): Promise<ProductDetailView | null> {
	// Solo le chiavi presenti: una chiave `undefined` non deve finire
	// nell'URL come stringa.
	const query: { storeId?: string; lat?: number; lng?: number } = {};
	if (params.storeId) query.storeId = params.storeId;
	if (params.coords) {
		query.lat = params.coords.lat;
		query.lng = params.coords.lng;
	}
	const res = await detail({ param: { id: productId }, query });
	if (res.status === 404) return null;
	if (!res.ok)
		throw new Error(`Caricamento prodotto non riuscito (${res.status})`);
	return (await res.json()).data;
}
