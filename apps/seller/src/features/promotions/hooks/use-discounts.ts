import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PromotionState } from "@/features/promotions/components/promotion-state-tabs";
import { api, unwrap } from "@/lib/api";

const DISCOUNTS_KEY = ["discounts"] as const;

interface ListParams {
	page: number;
	limit: number;
	state: PromotionState;
	search?: string;
}

export function useDiscountsList(
	params: ListParams,
	options?: { enabled?: boolean },
) {
	return useQuery({
		queryKey: [...DISCOUNTS_KEY, "list", params],
		queryFn: async () => {
			const res = await api().seller.discounts.get({ query: params });
			return unwrap(res, "Errore caricamento");
		},
		enabled: options?.enabled,
	});
}

export function useDiscount(discountId: string | undefined) {
	return useQuery({
		queryKey: [...DISCOUNTS_KEY, "detail", discountId],
		queryFn: async () => {
			if (!discountId) throw new Error("missing id");
			const res = await api().seller.discounts({ discountId }).get();
			return unwrap(res, "Errore caricamento");
		},
		enabled: !!discountId,
	});
}

export function usePauseDiscount() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (discountId: string) => {
			const res = await api().seller.discounts({ discountId }).pause.post();
			return unwrap(res, "Errore");
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
			return unwrap(res, "Errore");
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
			return unwrap(res, "Errore");
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
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
			return unwrap(res, "Errore");
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
			return unwrap(res, "Errore caricamento");
		},
		enabled: !!discountId,
	});
}

// Applies an existing promotion to a set of products: the discount is chosen at
// call time (the products-table picker), so discountId is a mutation variable
// rather than bound at hook creation. Invalidates the whole discounts cache so
// list product counts refresh.
export function useApplyPromotionToProducts() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (vars: { discountId: string; productIds: string[] }) => {
			const res = await api()
				.seller.discounts({ discountId: vars.discountId })
				.products.post({ productIds: vars.productIds });
			return unwrap(res, "Errore");
		},
		onSuccess: (_data, vars) => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
			void qc.invalidateQueries({
				queryKey: [...DISCOUNTS_KEY, "products", vars.discountId],
			});
		},
	});
}
