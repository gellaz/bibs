import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { Textarea } from "@bibs/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PackageIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/products")({
	component: ProductsPage,
	validateSearch: (search: Record<string, unknown>) => {
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
		};
	},
});

function ProductsPage() {
	const { page, limit } = Route.useSearch();
	const queryClient = useQueryClient();
	const [createOpen, setCreateOpen] = useState(false);
	const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

	const { data, isLoading, error } = useQuery({
		queryKey: ["products", page, limit],
		queryFn: async () => {
			const response = await api().seller.products.get({
				query: { page, limit },
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento prodotti",
				);
			}

			return response.data;
		},
	});

	const { data: categories } = useQuery({
		queryKey: ["categories"],
		queryFn: async () => {
			const response = await api().categories.get({
				query: { page: 1, limit: 100 },
			});

			if (response.error) {
				throw new Error("Errore nel caricamento categorie");
			}

			return response.data.data;
		},
	});

	const createMutation = useMutation({
		mutationFn: async (formData: {
			name: string;
			description?: string;
			price: string;
			categoryIds: string[];
		}) => {
			const response = await api().seller.products.post(formData);

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nella creazione",
				);
			}

			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["products"] });
			setCreateOpen(false);
			setSelectedCategories([]);
			toast.success("Prodotto creato con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante la creazione");
		},
	});

	const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const fd = new FormData(e.currentTarget);
		const name = (fd.get("name") as string).trim();
		const description = (fd.get("description") as string).trim() || undefined;
		const priceRaw = (fd.get("price") as string).trim();

		if (!name || !priceRaw || selectedCategories.length === 0) return;

		// Ensure price has exactly 2 decimal places
		const price = priceRaw.includes(".")
			? priceRaw
					.replace(/^(\d+\.\d{0,2}).*$/, "$1")
					.padEnd(priceRaw.indexOf(".") + 3, "0")
			: `${priceRaw}.00`;

		createMutation.mutate({
			name,
			description,
			price,
			categoryIds: selectedCategories,
		});
	};

	const toggleCategory = (categoryId: string) => {
		setSelectedCategories((prev) =>
			prev.includes(categoryId)
				? prev.filter((id) => id !== categoryId)
				: [...prev, categoryId],
		);
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Prodotti</h1>
					<p className="text-muted-foreground text-sm">
						Gestisci il catalogo dei tuoi prodotti
					</p>
				</div>
				<Button onClick={() => setCreateOpen(true)}>
					<PlusIcon />
					<span>Nuovo Prodotto</span>
				</Button>
			</div>

			{error && (
				<div className="bg-destructive/10 text-destructive rounded-lg border border-destructive/20 p-4">
					<p className="text-sm">
						Errore nel caricamento: {(error as Error).message}
					</p>
				</div>
			)}

			{isLoading ? (
				<div className="bg-card flex h-64 items-center justify-center rounded-lg border">
					<Spinner className="size-8" />
				</div>
			) : (
				<div className="bg-card overflow-hidden rounded-lg border shadow-sm">
					<Table>
						<TableHeader>
							<TableRow className="bg-muted/50 hover:bg-muted/50">
								<TableHead className="w-[35%] pl-6">Nome</TableHead>
								<TableHead className="w-[25%]">Prezzo</TableHead>
								<TableHead className="w-[20%]">Categoria</TableHead>
								<TableHead className="w-[20%] pr-6 text-right">
									Data Creazione
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.data && data.data.length > 0 ? (
								data.data.map((product) => (
									<TableRow key={product.id} className="group">
										<TableCell className="pl-6 font-semibold">
											{product.name}
										</TableCell>
										<TableCell className="text-sm">€{product.price}</TableCell>
										<TableCell className="text-sm">
											<div className="flex flex-wrap gap-1">
												{product.productClassifications.length > 0 ? (
													product.productClassifications.map((pc) => (
														<Badge
															key={pc.productCategoryId}
															variant="secondary"
														>
															{pc.category.name}
														</Badge>
													))
												) : (
													<span className="text-muted-foreground">—</span>
												)}
											</div>
										</TableCell>
										<TableCell className="pr-6 text-right text-muted-foreground text-sm">
											{new Date(product.createdAt).toLocaleDateString("it-IT", {
												year: "numeric",
												month: "long",
												day: "numeric",
											})}
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow className="hover:bg-transparent">
									<TableCell colSpan={4} className="h-32 text-center">
										<div className="flex flex-col items-center gap-2">
											<PackageIcon className="text-muted-foreground/40 size-8" />
											<div>
												<p className="text-muted-foreground font-medium">
													Nessun prodotto trovato
												</p>
												<p className="text-muted-foreground/60 text-sm">
													I tuoi prodotti appariranno qui
												</p>
											</div>
										</div>
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			)}

			{data?.pagination && data.pagination.total > 0 && (
				<div className="text-muted-foreground flex items-center justify-between text-sm">
					<div>
						Pagina {page} di {Math.ceil(data.pagination.total / limit)}
					</div>
					<div>
						Totale: {data.pagination.total} prodott
						{data.pagination.total === 1 ? "o" : "i"}
					</div>
				</div>
			)}

			{/* Create Product Dialog */}
			<Dialog
				open={createOpen}
				onOpenChange={(open) => {
					setCreateOpen(open);
					if (!open) setSelectedCategories([]);
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<form onSubmit={handleCreate}>
						<DialogHeader>
							<DialogTitle>Nuovo Prodotto</DialogTitle>
							<DialogDescription>
								Inserisci i dati del nuovo prodotto.
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="product-name">Nome *</Label>
								<Input
									id="product-name"
									name="name"
									placeholder="Es. Pizza Margherita"
									required
									autoFocus
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="product-description">Descrizione</Label>
								<Textarea
									id="product-description"
									name="description"
									placeholder="Descrizione del prodotto (opzionale)"
									rows={2}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="product-price">Prezzo (€) *</Label>
								<Input
									id="product-price"
									name="price"
									type="number"
									step="0.01"
									min="0.01"
									placeholder="9.99"
									required
								/>
							</div>

							<div className="space-y-2">
								<Label>
									Categorie *
									{selectedCategories.length > 0 && (
										<span className="ml-1 text-xs font-normal text-muted-foreground">
											({selectedCategories.length} selezionat
											{selectedCategories.length === 1 ? "a" : "e"})
										</span>
									)}
								</Label>
								{categories && categories.length > 0 ? (
									<div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
										{categories.map((cat) => (
											<label
												key={cat.id}
												htmlFor={`cat-${cat.id}`}
												className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
											>
												<Checkbox
													id={`cat-${cat.id}`}
													checked={selectedCategories.includes(cat.id)}
													onCheckedChange={() => toggleCategory(cat.id)}
												/>
												{cat.name}
											</label>
										))}
									</div>
								) : (
									<p className="text-xs text-muted-foreground">
										Nessuna categoria disponibile
									</p>
								)}
							</div>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setCreateOpen(false)}
							>
								Annulla
							</Button>
							<Button
								type="submit"
								disabled={
									createMutation.isPending || selectedCategories.length === 0
								}
							>
								{createMutation.isPending ? "Creazione..." : "Crea Prodotto"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
