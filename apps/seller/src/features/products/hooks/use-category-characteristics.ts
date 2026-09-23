import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";

async function fetchCategoryCharacteristics(productCategoryId: string) {
	const res = await api()
		.seller["product-categories"]({ productCategoryId })
		.characteristics.get();
	return unwrap(res, "Errore nel caricamento delle caratteristiche").data;
}

export type CategoryCharacteristic = Awaited<
	ReturnType<typeof fetchCategoryCharacteristics>
>[number];

export function useCategoryCharacteristics(
	productCategoryId: string | null | undefined,
) {
	return useQuery({
		queryKey: ["seller-category-characteristics", productCategoryId],
		queryFn: () => fetchCategoryCharacteristics(productCategoryId as string),
		enabled: !!productCategoryId,
		// La matrice cambia solo dall'admin: non serve rileggerla a ogni focus.
		staleTime: 5 * 60_000,
	});
}
