import type { Coords } from "@/features/location/coords";
import { apiNoDates } from "@/lib/api";

type DetailResponse = Awaited<
	ReturnType<
		ReturnType<ReturnType<typeof apiNoDates>["customer"]["products"]>["get"]
	>
>;
export type ProductDetailView = NonNullable<DetailResponse["data"]>["data"];
export type ProductCharacteristicView =
	ProductDetailView["characteristics"][number];

/**
 * La scheda di un prodotto, `null` se non è visibile (404). Passa da
 * `apiNoDates`, mai da `api`: vedi C8 nel piano PR 5.
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
	const { data, error } = await apiNoDates()
		.customer.products({ id: productId })
		.get({ query });
	if (error) {
		if (error.status === 404) return null;
		throw new Error(`Caricamento prodotto non riuscito (${error.status})`);
	}
	return data.data;
}
