import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

async function fetchCategoryCharacteristics(productCategoryId: string) {
	const res = await api()
		.seller["product-categories"]({ productCategoryId })
		.characteristics.get();
	return unwrap(res, m.products_characteristics_load_error()).data;
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
