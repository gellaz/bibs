import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PromotionState } from "@/features/promotions/components/promotion-state-tabs";
import { sellerApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

const DISCOUNTS_KEY = ["discounts"] as const;
// Prezzo e colonna promo della lista prodotti dipendono dalle promozioni: ogni
// mutation che cambia una promo o i suoi prodotti invalida anche questa.
const PRODUCTS_KEY = ["products"] as const;

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
			const res = await sellerApi.discounts.$get({ query: params });
			return unwrapJson(res, m.common_load_error());
		},
		enabled: options?.enabled,
	});
}

export function useDiscount(discountId: string | undefined) {
	return useQuery({
		queryKey: [...DISCOUNTS_KEY, "detail", discountId],
		queryFn: async () => {
			if (!discountId) throw new Error("missing id");
			const res = await sellerApi.discounts[":discountId"].$get({
				param: { discountId },
			});
			return unwrapJson(res, m.common_load_error());
		},
		enabled: !!discountId,
	});
}

export function usePauseDiscount() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (discountId: string) => {
			const res = await sellerApi.discounts[":discountId"].pause.$post({
				param: { discountId },
			});
			return unwrapJson(res, m.common_error());
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
			void qc.invalidateQueries({ queryKey: PRODUCTS_KEY });
		},
	});
}

export function useArchiveDiscount() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (discountId: string) => {
			const res = await sellerApi.discounts[":discountId"].archive.$post({
				param: { discountId },
			});
			return unwrapJson(res, m.common_error());
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
			void qc.invalidateQueries({ queryKey: PRODUCTS_KEY });
		},
	});
}

export function useUpdateDiscount(discountId: string) {
	const qc = useQueryClient();
	return useMutation({
		// Le `Date` escono come stringhe ISO (JSON.stringify), come prima.
		mutationFn: async (patch: {
			title?: string;
			percent?: number;
			startsAt?: Date;
			endsAt?: Date | null;
		}) => {
			const res = await sellerApi.discounts[":discountId"].$patch({
				param: { discountId },
				json: patch,
			});
			return unwrapJson(res, m.common_error());
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
			void qc.invalidateQueries({ queryKey: PRODUCTS_KEY });
		},
	});
}

export function useRemoveDiscountProducts(discountId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (productIds: string[]) => {
			const res = await sellerApi.discounts[":discountId"].products.$delete({
				param: { discountId },
				json: { productIds },
			});
			return unwrapJson(res, m.common_error());
		},
		onSuccess: () => {
			void qc.invalidateQueries({
				queryKey: [...DISCOUNTS_KEY, "products", discountId],
			});
			void qc.invalidateQueries({
				queryKey: [...DISCOUNTS_KEY, "detail", discountId],
			});
			void qc.invalidateQueries({ queryKey: PRODUCTS_KEY });
		},
	});
}

export function useDiscountProducts(discountId: string, page = 1, limit = 20) {
	return useQuery({
		queryKey: [...DISCOUNTS_KEY, "products", discountId, page, limit],
		queryFn: async () => {
			const res = await sellerApi.discounts[":discountId"].products.$get({
				param: { discountId },
				query: { page, limit },
			});
			return unwrapJson(res, m.common_load_error());
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
			const res = await sellerApi.discounts[":discountId"].products.$post({
				param: { discountId: vars.discountId },
				json: { productIds: vars.productIds },
			});
			return unwrapJson(res, m.common_error());
		},
		onSuccess: (_data, vars) => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
			void qc.invalidateQueries({
				queryKey: [...DISCOUNTS_KEY, "products", vars.discountId],
			});
			void qc.invalidateQueries({ queryKey: PRODUCTS_KEY });
		},
	});
}
