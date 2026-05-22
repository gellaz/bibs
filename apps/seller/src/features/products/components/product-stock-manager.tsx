"use no memo";

import { Button } from "@bibs/ui/components/button";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CopyPlusIcon, StoreIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { useActiveStore } from "@/hooks/use-active-store";
import { useStores } from "@/hooks/use-stores";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";
import { StockEditorCell } from "./stock-editor-cell";
import { StoreAssignmentDialog } from "./store-assignment-dialog";

interface StoreProduct {
	id: string;
	storeId: string;
	stock: number;
	store: { id: string; name: string; city: string };
}

interface Props {
	productId: string;
	storeProducts: StoreProduct[];
}

export function ProductStockManager({ productId, storeProducts }: Props) {
	const queryClient = useQueryClient();
	const { activeStore } = useActiveStore();
	const [addOpen, setAddOpen] = useState(false);

	const { data: stores } = useStores();

	const accessibleSet = useMemo(
		() => new Set(stores?.map((s) => s.id) ?? []),
		[stores],
	);

	const activeRow = storeProducts.find((sp) => sp.storeId === activeStore?.id);
	const otherAccessible = storeProducts.filter(
		(sp) => sp.storeId !== activeStore?.id && accessibleSet.has(sp.storeId),
	);
	const assignedStoreIds = storeProducts.map((sp) => sp.storeId);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ["product", productId] });
		void queryClient.invalidateQueries({ queryKey: ["products"] });
	};

	const removeMutation = useMutation({
		mutationFn: async (storeId: string) => {
			const response = await api()
				.seller.products({ productId })
				.stores({ storeId })
				.delete();
			if (response.error) throw new Error("Errore nella rimozione dal negozio");
		},
		onSuccess: () => {
			toast.success("Prodotto rimosso dal negozio");
			invalidate();
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const assignActiveMutation = useMutation({
		mutationFn: async () => {
			if (!activeStore) throw new Error("Nessun negozio attivo");
			const response = await api()
				.seller.products({ productId })
				.stores.post({ storeIds: [activeStore.id], stock: 0 });
			if (response.error) throw new Error("Errore assegnazione");
		},
		onSuccess: () => {
			toast.success("Prodotto reso disponibile");
			invalidate();
		},
		onError: (err: Error) => toast.error(err.message),
	});

	return (
		<div className="space-y-3">
			<div>
				<p className="text-sm font-medium">
					{m.products_stock_manager_heading()}
				</p>
				<p className="text-muted-foreground text-xs">
					{m.products_stock_manager_subtitle()}
				</p>
			</div>

			{activeRow ? (
				<div className="flex items-center gap-3 rounded-lg border px-3 py-2">
					<StoreIcon className="text-muted-foreground size-4 shrink-0" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-medium">
							{activeRow.store.name}
						</p>
						<p className="text-muted-foreground truncate text-xs">
							{activeRow.store.city}
						</p>
					</div>
					<StockEditorCell
						productId={productId}
						storeId={activeRow.storeId}
						stock={activeRow.stock}
					/>
					<button
						type="button"
						className="text-destructive hover:bg-destructive/10 flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-50"
						disabled={removeMutation.isPending}
						onClick={() => removeMutation.mutate(activeRow.storeId)}
					>
						<Trash2Icon className="size-3.5" />
					</button>
				</div>
			) : (
				<div className="space-y-2 rounded-lg border border-dashed p-4 text-center">
					<p className="text-muted-foreground text-sm">
						{m.products_stock_manager_empty_active({
							storeName: activeStore?.name ?? "",
						})}
					</p>
					<Button
						size="sm"
						onClick={() => assignActiveMutation.mutate()}
						disabled={assignActiveMutation.isPending || !activeStore}
					>
						{m.products_stock_manager_make_available_here()}
					</Button>
				</div>
			)}

			{otherAccessible.length > 0 && (
				<p className="text-muted-foreground text-xs">
					{m.products_stock_manager_also_in()}{" "}
					{otherAccessible
						.map((sp) => `${sp.store.name} (${sp.stock})`)
						.join(", ")}
				</p>
			)}

			<Button
				variant="outline"
				className="w-full"
				onClick={() => setAddOpen(true)}
			>
				<CopyPlusIcon className="size-4" />
				{m.products_stock_manager_add_to_another()}
			</Button>

			<StoreAssignmentDialog
				productId={productId}
				assignedStoreIds={assignedStoreIds}
				open={addOpen}
				onOpenChange={setAddOpen}
			/>
		</div>
	);
}
