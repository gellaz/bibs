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

export function useUpdateDiscount(discountId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (patch: {
			title?: string;
			percent?: number;
			startsAt?: Date;
			endsAt?: Date | null;
		}) => {
			const res = await api().seller.discounts({ discountId }).patch(patch);
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
		},
	});
}

export function useAddDiscountProducts(discountId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (productIds: string[]) => {
			const res = await api()
				.seller.discounts({ discountId })
				.products.post({ productIds });
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({
				queryKey: [...DISCOUNTS_KEY, "products", discountId],
			});
			void qc.invalidateQueries({
				queryKey: [...DISCOUNTS_KEY, "detail", discountId],
			});
		},
	});
}

export function useRemoveDiscountProducts(discountId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (productIds: string[]) => {
			const res = await api()
				.seller.discounts({ discountId })
				.products.delete({ productIds });
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({
				queryKey: [...DISCOUNTS_KEY, "products", discountId],
			});
			void qc.invalidateQueries({
				queryKey: [...DISCOUNTS_KEY, "detail", discountId],
			});
		},
	});
}

export function useDiscountProducts(discountId: string, page = 1, limit = 20) {
	return useQuery({
		queryKey: [...DISCOUNTS_KEY, "products", discountId, page, limit],
		queryFn: async () => {
			const res = await api()
				.seller.discounts({ discountId })
				.products.get({ query: { page, limit } });
			if (res.error)
				throw new Error(res.error.value?.message || "Errore caricamento");
			return res.data;
		},
		enabled: !!discountId,
	});
}
