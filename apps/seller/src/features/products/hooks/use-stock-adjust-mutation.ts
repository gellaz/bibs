// apps/seller/src/features/products/hooks/use-stock-adjust-mutation.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface AdjustParams {
	productId: string;
	storeId: string;
	delta: number;
}

interface SetParams {
	productId: string;
	storeId: string;
	stock: number;
}

type StoreProduct = {
	id: string;
	productId: string;
	storeId: string;
	stock: number;
};

export function useStockAdjustMutation() {
	const queryClient = useQueryClient();

	const patchCache = (updated: StoreProduct) => {
		// Patcha tutte le query ["product", productId] e ["products", ...]
		queryClient.setQueriesData(
			{ queryKey: ["product", updated.productId] },
			(old: any) => {
				if (!old?.data) return old;
				return {
					...old,
					data: {
						...old.data,
						storeProducts: old.data.storeProducts.map((sp: StoreProduct) =>
							sp.storeId === updated.storeId
								? { ...sp, stock: updated.stock }
								: sp,
						),
					},
				};
			},
		);
		queryClient.setQueriesData({ queryKey: ["products"] }, (old: any) => {
			if (!old?.data) return old;
			return {
				...old,
				data: old.data.map((p: any) =>
					p.id !== updated.productId
						? p
						: {
								...p,
								storeProducts: p.storeProducts.map((sp: StoreProduct) =>
									sp.storeId === updated.storeId
										? { ...sp, stock: updated.stock }
										: sp,
								),
							},
				),
			};
		});
	};

	const adjust = useMutation({
		mutationFn: async ({ productId, storeId, delta }: AdjustParams) => {
			const response = await api()
				.seller.products({ productId })
				.stores({ storeId })
				["stock-adjust"].post({ delta });
			if (response.error) {
				const err = new Error(response.error.value?.message || "Errore stock");
				(err as any).status = response.status;
				throw err;
			}
			return response.data.data as StoreProduct;
		},
		onSuccess: (data) => patchCache(data),
	});

	const set = useMutation({
		mutationFn: async ({ productId, storeId, stock }: SetParams) => {
			const response = await api()
				.seller.products({ productId })
				.stores({ storeId })
				.patch({ stock });
			if (response.error) {
				const err = new Error(response.error.value?.message || "Errore stock");
				(err as any).status = response.status;
				throw err;
			}
			return response.data.data as StoreProduct;
		},
		onSuccess: (data) => patchCache(data),
	});

	return { adjust, set };
}
