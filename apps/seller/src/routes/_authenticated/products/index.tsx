import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { PageSizeSelector } from "@bibs/ui/components/page-size-selector";
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
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PackageIcon, PlusIcon } from "lucide-react";
import { useMemo } from "react";
import { ProductBulkToolbar } from "@/features/products/components/product-bulk-toolbar";
import { ProductRowActions } from "@/features/products/components/product-row-actions";
import {
	type ProductStatusFilter,
	ProductStatusTabs,
} from "@/features/products/components/product-status-tabs";
import { useProductSelection } from "@/features/products/hooks/use-product-selection";
import { useActiveStore } from "@/hooks/use-active-store";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/products/")({
	component: ProductsListPage,
	validateSearch: (search: Record<string, unknown>) => {
		const sf = search.statusFilter;
		const statusFilter: ProductStatusFilter =
			sf === "disabled" || sf === "trashed" ? sf : "active";
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
			statusFilter,
		};
	},
});

function ProductsListPage() {
	const { page, limit, statusFilter } = Route.useSearch();
	const navigate = useNavigate({ from: "/products/" });
	const { activeStore } = useActiveStore();

	const { data, isLoading, error } = useQuery({
		queryKey: ["products", activeStore?.id, page, limit, statusFilter],
		queryFn: async () => {
			const storeId = activeStore?.id;
			if (!storeId) throw new Error("No active store");
			const response = await api().seller.products.get({
				query: { storeId, page, limit, statusFilter },
			});
			if (response.error) {
				throw new Error(response.error.value?.message || "Errore caricamento");
			}
			return response.data;
		},
		enabled: !!activeStore?.id,
	});

	const currentPageIds = useMemo(
		() => data?.data?.map((p) => p.id) ?? [],
		[data],
	);
	const selection = useProductSelection({
		currentPageIds,
		resetKey: `${activeStore?.id ?? ""}|${statusFilter}`,
	});

	const goToTab = (next: ProductStatusFilter) =>
		void navigate({
			search: (prev) => ({ ...prev, statusFilter: next, page: 1 }),
		});

	const emptyMessage =
		statusFilter === "active"
			? m.products_empty_active()
			: statusFilter === "disabled"
				? m.products_empty_disabled()
				: m.products_empty_trashed();

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">
						Prodotti{activeStore ? ` — ${activeStore.name}` : ""}
					</h1>
					<p className="text-muted-foreground text-sm">
						{activeStore
							? `Catalogo del negozio ${activeStore.name}`
							: "Seleziona un negozio per visualizzare il catalogo"}
					</p>
				</div>
				<Button asChild>
					<Link to="/products/new">
						<PlusIcon />
						<span>Nuovo Prodotto</span>
					</Link>
				</Button>
			</div>

			{activeStore && (
				<ProductStatusTabs
					storeId={activeStore.id}
					value={statusFilter}
					onChange={goToTab}
				/>
			)}

			<ProductBulkToolbar
				selectedIds={Array.from(selection.selected)}
				activeStoreId={activeStore?.id ?? ""}
				statusFilter={statusFilter}
				onClear={selection.clear}
			/>

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
								<TableHead className="w-10 pl-4">
									<Checkbox
										checked={
											selection.headerCheckboxState === "checked"
												? true
												: selection.headerCheckboxState === "indeterminate"
													? "indeterminate"
													: false
										}
										onCheckedChange={() => selection.toggleAllOnPage()}
										aria-label="Seleziona tutti"
									/>
								</TableHead>
								<TableHead className="w-[35%]">Nome</TableHead>
								<TableHead className="w-[20%]">Prezzo</TableHead>
								<TableHead className="w-[20%]">Categoria</TableHead>
								<TableHead className="w-[15%]">Data</TableHead>
								<TableHead className="w-12 pr-4" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.data && data.data.length > 0 ? (
								data.data.map((product) => (
									<TableRow key={product.id} className="group">
										<TableCell className="pl-4">
											<Checkbox
												checked={selection.isSelected(product.id)}
												onCheckedChange={() => selection.toggleOne(product.id)}
												aria-label={`Seleziona ${product.name}`}
											/>
										</TableCell>
										<TableCell className="font-semibold">
											{statusFilter === "trashed" ? (
												<span className="text-muted-foreground">
													{product.name}
												</span>
											) : (
												<Link
													to="/products/$productId"
													params={{ productId: product.id }}
													className="hover:underline"
												>
													{product.name}
												</Link>
											)}
										</TableCell>
										<TableCell className="text-sm">€{product.price}</TableCell>
										<TableCell className="text-sm">
											<div className="flex flex-wrap gap-1">
												{product.productCategoryAssignments.length > 0 ? (
													product.productCategoryAssignments.map((pc) => (
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
										<TableCell className="text-muted-foreground text-sm">
											{new Date(product.createdAt).toLocaleDateString("it-IT", {
												year: "numeric",
												month: "short",
												day: "numeric",
											})}
										</TableCell>
										<TableCell className="pr-4">
											<ProductRowActions
												productId={product.id}
												status={product.status}
												activeStoreId={activeStore?.id ?? ""}
											/>
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow className="hover:bg-transparent">
									<TableCell colSpan={6} className="h-32 text-center">
										<div className="flex flex-col items-center gap-2">
											<PackageIcon className="text-muted-foreground/40 size-8" />
											<p className="text-muted-foreground font-medium">
												{emptyMessage}
											</p>
										</div>
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			)}

			{data?.pagination &&
				data.pagination.total > 0 &&
				(() => {
					const total = data.pagination.total;
					const totalPages = Math.ceil(total / limit);
					const rangeStart = (page - 1) * limit + 1;
					const rangeEnd = Math.min(page * limit, total);
					return (
						<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
							<p className="text-muted-foreground text-sm tabular-nums">
								{rangeStart}–{rangeEnd} di {total} prodott
								{total === 1 ? "o" : "i"}
							</p>
							<div className="flex items-center gap-4">
								<PageSizeSelector
									pageSize={limit}
									onPageSizeChange={(size) =>
										void navigate({
											search: (prev) => ({ ...prev, limit: size, page: 1 }),
										})
									}
								/>
								<DataPagination
									page={page}
									totalPages={totalPages}
									onPageChange={(next) =>
										void navigate({
											search: (prev) => ({ ...prev, page: next }),
										})
									}
								/>
							</div>
						</div>
					);
				})()}
		</div>
	);
}
