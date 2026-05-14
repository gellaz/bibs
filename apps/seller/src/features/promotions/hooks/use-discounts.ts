import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PromotionState } from "@/features/promotions/components/promotion-state-tabs";
import { api } from "@/lib/api";

const DISCOUNTS_KEY = ["discounts"] as const;

interface ListParams {
	page: number;
	limit: number;
	state: PromotionState;
	search?: string;
}

export function useDiscountsList(params: ListParams) {
	return useQuery({
		queryKey: [...DISCOUNTS_KEY, "list", params],
		queryFn: async () => {
			const res = await api().seller.discounts.get({ query: params });
			if (res.error)
				throw new Error(res.error.value?.message || "Errore caricamento");
			return res.data;
		},
	});
}

export function useDiscount(discountId: string | undefined) {
	return useQuery({
		queryKey: [...DISCOUNTS_KEY, "detail", discountId],
		queryFn: async () => {
			if (!discountId) throw new Error("missing id");
			const res = await api().seller.discounts({ discountId }).get();
			if (res.error)
				throw new Error(res.error.value?.message || "Errore caricamento");
			return res.data;
		},
		enabled: !!discountId,
	});
}

export function usePauseDiscount() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (discountId: string) => {
			const res = await api().seller.discounts({ discountId }).pause.post();
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
		},
	});
}

export function useArchiveDiscount() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (discountId: string) => {
			const res = await api().seller.discounts({ discountId }).archive.post();
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
		},
	});
}
