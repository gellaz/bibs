import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { Spinner } from "@bibs/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PackageIcon, PlusIcon } from "lucide-react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/products/")({
	component: ProductsListPage,
	validateSearch: (search: Record<string, unknown>) => {
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
		};
	},
});

function ProductsListPage() {
	const { page, limit } = Route.useSearch();

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

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Prodotti</h1>
					<p className="text-muted-foreground text-sm">
						Gestisci il catalogo dei tuoi prodotti
					</p>
				</div>
				<Button asChild>
					<Link to="/products/new">
						<PlusIcon />
						<span>Nuovo Prodotto</span>
					</Link>
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
											<Link
												to="/products/$productId"
												params={{ productId: product.id }}
												className="hover:underline"
											>
												{product.name}
											</Link>
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
		</div>
	);
}
