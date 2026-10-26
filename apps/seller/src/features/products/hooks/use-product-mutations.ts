import { toast } from "@bibs/ui/components/sonner";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sellerApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

type ProductStatus = "active" | "disabled" | "trashed";

interface SetStatusVars {
	productId: string;
	status: ProductStatus;
	/** Status before the mutation, for the Undo toast action. */
	previousStatus: ProductStatus;
	/**
	 * Set when this mutation is dispatched as the inverse of a previous one
	 * (i.e. via the "Annulla" toast action). Suppresses the Undo button on the
	 * confirmation toast so the user can't undo the undo, ad infinitum.
	 */
	isUndo?: boolean;
}

interface BulkSetStatusVars {
	productIds: string[];
	status: ProductStatus;
}

interface BulkDeletePermanentVars {
	productIds: string[];
}

export function useProductMutations() {
	const queryClient = useQueryClient();

	function invalidateAll() {
		void queryClient.invalidateQueries({ queryKey: ["products"] });
		void queryClient.invalidateQueries({ queryKey: ["product-status-counts"] });
		// Il filtro categorie è scopato per status: un cambio di stato lo sposta.
		void queryClient.invalidateQueries({
			queryKey: ["seller-categories-in-use"],
		});
	}

	const setStatus = useMutation({
		mutationFn: async (vars: SetStatusVars) => {
			const res = await sellerApi.products[":productId"].status.$patch({
				param: { productId: vars.productId },
				json: { status: vars.status },
			});
			return unwrapJson(res, m.products_status_update_error());
		},
		onSuccess: (_data, vars) => {
			invalidateAll();
			if (vars.isUndo) {
				toast.success(m.products_toast_status_changed());
				return;
			}
			toast.success(m.products_toast_status_changed(), {
				action: {
					label: m.products_toast_undo(),
					onClick: () => {
						setStatus.mutate({
							productId: vars.productId,
							status: vars.previousStatus,
							previousStatus: vars.status,
							isUndo: true,
						});
					},
				},
			});
		},
		onError: (err: Error) => {
			toast.error(err.message);
		},
	});

	const bulkSetStatus = useMutation({
		mutationFn: async (vars: BulkSetStatusVars) => {
			const res = await sellerApi.products.bulk.status.$post({
				json: { productIds: vars.productIds, status: vars.status },
			});
			return (await unwrapJson(res, m.products_bulk_update_error())).data;
		},
		onSuccess: (data) => {
			invalidateAll();
			toast.success(
				m.products_toast_bulk_summary({
					succeeded: data.succeeded.length,
					failed: data.failed.length,
				}),
			);
		},
		onError: (err: Error) => {
			toast.error(err.message);
		},
	});

	const bulkDeletePermanent = useMutation({
		mutationFn: async (vars: BulkDeletePermanentVars) => {
			const res = await sellerApi.products.bulk["delete-permanent"].$post({
				json: { productIds: vars.productIds },
			});
			return (await unwrapJson(res, m.products_delete_error())).data;
		},
		onSuccess: (data) => {
			invalidateAll();
			toast.success(
				m.products_toast_bulk_delete_summary({
					succeeded: data.succeeded.length,
					failed: data.failed.length,
				}),
			);
		},
		onError: (err: Error) => {
			toast.error(err.message);
		},
	});

	return { setStatus, bulkSetStatus, bulkDeletePermanent };
}
