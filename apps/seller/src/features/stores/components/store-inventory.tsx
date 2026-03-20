import { Badge } from "@bibs/ui/components/badge";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	MinusIcon,
	PackageIcon,
	PackageXIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/lib/api";

interface StoreInventoryProps {
	storeId: string;
}

const DEBOUNCE_MS = 700;

export function StoreInventory({ storeId }: StoreInventoryProps) {
	const queryClient = useQueryClient();

	const { data, isLoading } = useQuery({
		queryKey: ["products"],
		queryFn: async () => {
			const response = await api().seller.products.get({
				query: { page: 1, limit: 100 },
			});
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento prodotti",
				);
			}
			return response.data;
		},
	});

	const [localStocks, setLocalStocks] = useState<Record<string, number>>({});
	const [savingProducts, setSavingProducts] = useState<Set<string>>(new Set());
	const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

	const invalidate = () =>
		void queryClient.invalidateQueries({ queryKey: ["products"] });

	const scheduleSave = (productId: string, stock: number) => {
		clearTimeout(saveTimers.current[productId]);
		saveTimers.current[productId] = setTimeout(() => {
			setSavingProducts((prev) => new Set(prev).add(productId));
			updateMutation.mutate({ productId, stock });
		}, DEBOUNCE_MS);
	};

	const adjustStock = (
		productId: string,
		currentStock: number,
		delta: number,
	) => {
		setLocalStocks((prev) => {
			const current = productId in prev ? prev[productId] : currentStock;
			const next = Math.max(0, current + delta);
			scheduleSave(productId, next);
			return { ...prev, [productId]: next };
		});
	};

	const assignMutation = useMutation({
		mutationFn: async (productId: string) => {
			const response = await api()
				.seller.products({ productId })
				.stores.post({ storeIds: [storeId], stock: 0 });
			if (response.error)
				throw new Error("Errore nell'assegnazione al negozio");
		},
		onSuccess: () => {
			toast.success("Prodotto aggiunto al negozio");
			invalidate();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			productId,
			stock,
		}: {
			productId: string;
			stock: number;
		}) => {
			const response = await api()
				.seller.products({ productId })
				.stores({ storeId })
				.patch({ stock });
			if (response.error)
				throw new Error("Errore nell'aggiornamento dello stock");
		},
		onSuccess: (_, { productId }) => {
			setSavingProducts((prev) => {
				const next = new Set(prev);
				next.delete(productId);
				return next;
			});
			setLocalStocks((prev) => {
				const next = { ...prev };
				delete next[productId];
				return next;
			});
			invalidate();
		},
		onError: (_, { productId }) => {
			setSavingProducts((prev) => {
				const next = new Set(prev);
				next.delete(productId);
				return next;
			});
			toast.error("Errore nell'aggiornamento dello stock");
		},
	});

	const removeMutation = useMutation({
		mutationFn: async (productId: string) => {
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

	if (isLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<Spinner className="size-5" />
			</div>
		);
	}

	const products = data?.data ?? [];

	if (products.length === 0) {
		return (
			<div className="flex flex-col items-center gap-2 py-12 text-center">
				<PackageXIcon className="text-muted-foreground/40 size-10" />
				<p className="text-muted-foreground text-sm">
					Nessun prodotto disponibile.
					<br />
					Crea prima i prodotti dalla sezione Prodotti.
				</p>
			</div>
		);
	}

	const assigned = products.filter((p) =>
		p.storeProducts?.some((s) => s.storeId === storeId),
	);
	const unassigned = products.filter(
		(p) => !p.storeProducts?.some((s) => s.storeId === storeId),
	);

	return (
		<div className="space-y-6">
			{/* Assigned products */}
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<p className="text-sm font-medium">In questo negozio</p>
					<Badge variant="secondary" className="text-xs">
						{assigned.length}
					</Badge>
				</div>

				{assigned.length === 0 ? (
					<p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
						Nessun prodotto assegnato. Aggiungine uno dalla lista qui sotto.
					</p>
				) : (
					<div className="space-y-1.5">
						{assigned.map((product) => {
							const sp = product.storeProducts?.find(
								(s) => s.storeId === storeId,
							);
							const stock =
								product.id in localStocks
									? localStocks[product.id]
									: (sp?.stock ?? 0);
							const isSaving = savingProducts.has(product.id);

							return (
								<div
									key={product.id}
									className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
								>
									<PackageIcon className="text-muted-foreground size-4 shrink-0" />
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium">
											{product.name}
										</p>
										<p className="text-muted-foreground truncate text-xs">
											€{product.price}
										</p>
									</div>

									<div className="flex items-center gap-2">
										<div className="flex h-8 items-center overflow-hidden rounded-md border">
											<button
												type="button"
												onClick={() => adjustStock(product.id, stock, -1)}
												disabled={stock <= 0 || isSaving}
												className="flex h-full w-8 items-center justify-center transition-colors hover:bg-muted disabled:opacity-30"
											>
												<MinusIcon className="size-3" />
											</button>
											<div className="relative">
												<input
													type="number"
													min={0}
													value={stock}
													disabled={isSaving}
													onChange={(e) => {
														const val = Math.max(0, Number(e.target.value));
														setLocalStocks((prev) => ({
															...prev,
															[product.id]: val,
														}));
														scheduleSave(product.id, val);
													}}
													className="w-12 bg-transparent text-center text-sm tabular-nums focus:outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
												/>
												{isSaving && (
													<span className="absolute -top-1 -right-1">
														<span className="bg-primary size-1.5 animate-pulse rounded-full block" />
													</span>
												)}
											</div>
											<button
												type="button"
												onClick={() => adjustStock(product.id, stock, 1)}
												disabled={isSaving}
												className="flex h-full w-8 items-center justify-center transition-colors hover:bg-muted disabled:opacity-30"
											>
												<PlusIcon className="size-3" />
											</button>
										</div>
										<button
											type="button"
											className="flex h-8 w-8 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
											disabled={removeMutation.isPending}
											onClick={() => removeMutation.mutate(product.id)}
										>
											<Trash2Icon className="size-3.5" />
										</button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Unassigned products */}
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<p className="text-muted-foreground text-sm font-medium">
						Aggiungi al negozio
					</p>
					{unassigned.length > 0 && (
						<Badge variant="outline" className="text-xs">
							{unassigned.length}
						</Badge>
					)}
				</div>

				{unassigned.length === 0 ? (
					<p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
						Tutti i prodotti sono già disponibili in questo negozio.
					</p>
				) : (
					<div className="space-y-1.5">
						{unassigned.map((product) => (
							<div
								key={product.id}
								className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 opacity-70 transition-opacity hover:opacity-100"
							>
								<PackageIcon className="text-muted-foreground size-4 shrink-0" />
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium">{product.name}</p>
									<p className="text-muted-foreground truncate text-xs">
										€{product.price}
									</p>
								</div>
								<button
									type="button"
									disabled={assignMutation.isPending}
									onClick={() => assignMutation.mutate(product.id)}
									className="flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
								>
									<PlusIcon className="size-3.5" />
									Aggiungi
								</button>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
