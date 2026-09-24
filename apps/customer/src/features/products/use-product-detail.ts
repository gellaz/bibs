import { useQuery } from "@tanstack/react-query";
import { useSearchOrigin } from "@/features/location/search-origin";
import { fetchProductDetail } from "./product-detail-api";

/**
 * La scheda di un prodotto. L'origine di ricerca entra nella chiave: cambiando
 * indirizzo dal chip, il negozio più vicino può cambiare. Con `storeId` le
 * coordinate servono solo se quel negozio non ce l'ha più.
 */
export function useProductDetail(
	productId: string,
	storeId: string | undefined,
) {
	const { coords } = useSearchOrigin();
	return useQuery({
		queryKey: [
			"product-detail",
			productId,
			storeId ?? null,
			coords?.lat ?? null,
			coords?.lng ?? null,
		],
		staleTime: 60_000,
		queryFn: () => fetchProductDetail(productId, { storeId, coords }),
	});
}
