import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { StoreIcon, Trash2Icon } from "lucide-react";
import { api } from "@/lib/api";

interface StoreProduct {
	id: string;
	storeId: string;
	stock: number;
	store: { id: string; name: string; city: string };
}

interface ProductStockManagerProps {
	productId: string;
	storeProducts: StoreProduct[];
}

export function ProductStockManager({
	productId,
	storeProducts,
}: ProductStockManagerProps) {
	const queryClient = useQueryClient();

	const invalidate = () =>
		void queryClient.invalidateQueries({ queryKey: ["product", productId] });

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
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<div className="space-y-3">
			<div>
				<p className="text-sm font-medium">Disponibilità per negozio</p>
				<p className="text-muted-foreground text-xs">
					Scegli in quali negozi è disponibile questo prodotto. Gestisci le
					quantità dalla sezione Inventario del negozio.
				</p>
			</div>

			<div className="space-y-2">
				{storeProducts.map((sp) => (
					<div
						key={sp.storeId}
						className="flex items-center gap-3 rounded-lg border px-3 py-2"
					>
						<StoreIcon className="text-muted-foreground size-4 shrink-0" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">{sp.store.name}</p>
							<p className="text-muted-foreground truncate text-xs">
								{sp.store.city} · {sp.stock} pz.
							</p>
						</div>
						<button
							type="button"
							className="flex h-8 w-8 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
							disabled={removeMutation.isPending}
							onClick={() => removeMutation.mutate(sp.storeId)}
						>
							<Trash2Icon className="size-3.5" />
						</button>
					</div>
				))}

				{storeProducts.length === 0 && (
					<p className="text-muted-foreground text-xs">
						Nessun negozio assegnato.
					</p>
				)}
			</div>
		</div>
	);
}
