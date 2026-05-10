import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
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

export function useProductMutations(activeStoreId: string | undefined) {
	const queryClient = useQueryClient();

	function invalidateAll() {
		void queryClient.invalidateQueries({ queryKey: ["products"] });
		void queryClient.invalidateQueries({ queryKey: ["product-status-counts"] });
	}

	const setStatus = useMutation({
		mutationFn: async (vars: SetStatusVars) => {
			const res = await api()
				.seller.products({ productId: vars.productId })
				.status.patch({ status: vars.status });
			if (res.error) {
				throw new Error(
					res.error.value?.message ?? "Errore aggiornamento stato",
				);
			}
			return res.data;
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
			const res = await api().seller.products.bulk.status.post({
				productIds: vars.productIds,
				status: vars.status,
			});
			if (res.error) {
				throw new Error(res.error.value?.message ?? "Errore bulk update");
			}
			return res.data.data;
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
			const res = await api().seller.products.bulk["delete-permanent"].post({
				productIds: vars.productIds,
			});
			if (res.error) {
				throw new Error(res.error.value?.message ?? "Errore eliminazione");
			}
			return res.data.data;
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

	void activeStoreId;

	return { setStatus, bulkSetStatus, bulkDeletePermanent };
}
