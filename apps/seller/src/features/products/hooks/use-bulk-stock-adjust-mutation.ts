import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Mode = "delta" | "set";

interface MutateParams {
	storeId: string;
	productIds: string[];
	mode: Mode;
	value: number;
}

type StoreProduct = {
	id: string;
	productId: string;
	storeId: string;
	stock: number;
};

interface BulkResult {
	succeeded: StoreProduct[];
	failed: Array<{
		productId: string;
		reason: "not_found" | "would_go_negative";
	}>;
}

export function useBulkStockAdjustMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (params: MutateParams): Promise<BulkResult> => {
			const response =
				await api().seller.products.bulk["stock-adjust"].post(params);
			if (response.error)
				throw new Error(response.error.value?.message || "Errore");
			return response.data.data as BulkResult;
		},
		onSuccess: (result) => {
			// Patcha la lista per ogni riga succeeded
			queryClient.setQueriesData({ queryKey: ["products"] }, (old: any) => {
				if (!old?.data) return old;
				const byProductStore = new Map(
					result.succeeded.map((sp) => [
						`${sp.productId}|${sp.storeId}`,
						sp.stock,
					]),
				);
				return {
					...old,
					data: old.data.map((p: any) => ({
						...p,
						storeProducts: p.storeProducts.map((sp: StoreProduct) => {
							const next = byProductStore.get(`${p.id}|${sp.storeId}`);
							return next === undefined ? sp : { ...sp, stock: next };
						}),
					})),
				};
			});
		},
	});
}
