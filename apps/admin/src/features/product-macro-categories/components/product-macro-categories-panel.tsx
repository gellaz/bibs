import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { DataTable } from "@bibs/ui/components/data-table";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { Input } from "@bibs/ui/components/input";
import { PageSizeSelector } from "@bibs/ui/components/page-size-selector";
import { toast } from "@bibs/ui/components/sonner";
import type { SortOrder } from "@bibs/ui/components/sortable-table-head";
import { SortableHeadButton } from "@bibs/ui/components/sortable-table-head";
import { TableColumnsToggle } from "@bibs/ui/components/table-columns-toggle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { LayersIcon, PencilIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProductMacroCategoryForm } from "@/features/product-macro-categories/components/product-macro-category-form";
import { api } from "@/lib/api";

interface ProductMacroCategory {
	id: string;
	name: string;
	createdAt: Date | string;
	updatedAt: Date | string;
}

interface ProductMacroCategoriesPanelProps {
	createOpen: boolean;
	onCreateOpenChange: (open: boolean) => void;
}

type SortByField = "name" | "createdAt";

const DATE_FMT_OPTS: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "long",
	day: "numeric",
};

export function ProductMacroCategoriesPanel({
	createOpen,
	onCreateOpenChange,
}: ProductMacroCategoriesPanelProps) {
	"use no memo";

	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(20);
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [sortBy, setSortBy] = useState<SortByField>("name");
	const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
	const queryClient = useQueryClient();
	const [editOpen, setEditOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [selectedMacro, setSelectedMacro] =
		useState<ProductMacroCategory | null>(null);

	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		debounceRef.current = setTimeout(() => {
			setDebouncedSearch(search);
			setPage(1);
		}, 300);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [search]);

	const handleSort = (field: SortByField) => {
		if (sortBy === field) {
			setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(field);
			setSortOrder("asc");
		}
		setPage(1);
	};

	const { data, isLoading, error } = useQuery({
		queryKey: [
			"product-macro-categories",
			page,
			limit,
			debouncedSearch,
			sortBy,
			sortOrder,
		],
		queryFn: async () => {
			const response = await api()["product-macro-categories"].get({
				query: {
					page,
					limit,
					...(debouncedSearch ? { search: debouncedSearch } : {}),
					sortBy,
					sortOrder,
				},
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message ||
						"Failed to fetch product macro categories",
				);
			}

			return response.data;
		},
	});

	const invalidateAll = () => {
		void queryClient.invalidateQueries({
			queryKey: ["product-macro-categories"],
		});
		void queryClient.invalidateQueries({
			queryKey: ["product-categories"],
		});
		void queryClient.invalidateQueries({
			queryKey: ["admin-configurations-counts"],
		});
	};

	const createMutation = useMutation({
		mutationFn: async (name: string) => {
			const response = await api().admin["product-macro-categories"].post({
				name,
			});
			if (response.error) {
				throw new Error(
					response.error.value?.message ||
						"Failed to create product macro category",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateAll();
			onCreateOpenChange(false);
			toast.success("Macro categoria prodotto creata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante la creazione");
		},
	});

	const updateMutation = useMutation({
		mutationFn: async ({ id, name }: { id: string; name: string }) => {
			const response = await api()
				.admin["product-macro-categories"]({ macroCategoryId: id })
				.patch({ name });
			if (response.error) {
				throw new Error(
					response.error.value?.message ||
						"Failed to update product macro category",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateAll();
			setEditOpen(false);
			setSelectedMacro(null);
			toast.success("Macro categoria prodotto aggiornata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'aggiornamento");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const response = await api()
				.admin["product-macro-categories"]({ macroCategoryId: id })
				.delete();
			if (response.error) {
				throw new Error(
					response.error.value?.message ||
						"Failed to delete product macro category",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateAll();
			setDeleteOpen(false);
			setSelectedMacro(null);
			toast.success("Macro categoria prodotto eliminata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'eliminazione");
		},
	});

	const handleDelete = () => {
		if (!selectedMacro) return;
		deleteMutation.mutate(selectedMacro.id);
	};

	const rows = useMemo<ProductMacroCategory[]>(
		() => (data?.data as ProductMacroCategory[]) ?? [],
		[data],
	);

	const columns = useMemo<ColumnDef<ProductMacroCategory>[]>(
		() => [
			{
				id: "name",
				enableHiding: false,
				meta: {
					menuLabel: "Nome",
					headerClassName: "w-[40%] pl-4",
					cellClassName: "pl-6 font-semibold",
				},
				header: () => (
					<SortableHeadButton
						active={sortBy === "name"}
						sortOrder={sortOrder}
						onSort={() => handleSort("name")}
					>
						Nome
					</SortableHeadButton>
				),
				cell: ({ row }) => row.original.name,
			},
			{
				id: "createdAt",
				meta: {
					menuLabel: "Data creazione",
					headerClassName: "w-[40%]",
					cellClassName: "text-muted-foreground text-sm",
				},
				header: () => (
					<SortableHeadButton
						active={sortBy === "createdAt"}
						sortOrder={sortOrder}
						onSort={() => handleSort("createdAt")}
					>
						Data Creazione
					</SortableHeadButton>
				),
				cell: ({ row }) =>
					new Date(row.original.createdAt).toLocaleDateString(
						"it-IT",
						DATE_FMT_OPTS,
					),
			},
			{
				id: "actions",
				enableHiding: false,
				meta: {
					headerClassName: "w-[20%] pr-6 text-right",
					cellClassName: "pr-6 text-right",
				},
				header: ({ table }) => <TableColumnsToggle table={table} align="end" />,
				cell: ({ row }) => (
					<div className="flex items-center justify-end gap-1">
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => {
								setSelectedMacro(row.original);
								setEditOpen(true);
							}}
							aria-label="Modifica macro categoria"
						>
							<PencilIcon className="size-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => {
								setSelectedMacro(row.original);
								setDeleteOpen(true);
							}}
							aria-label="Elimina macro categoria"
						>
							<Trash2Icon className="size-4" />
						</Button>
					</div>
				),
			},
		],
		[sortBy, sortOrder],
	);

	return (
		<div className="space-y-4">
			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">
						Errore nel caricamento: {(error as Error).message}
					</p>
				</div>
			)}

			<div className="relative">
				<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
				<Input
					placeholder="Cerca macro categoria..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="pl-9"
				/>
			</div>

			<DataTable
				data={rows}
				columns={columns}
				storageKey="admin.product-macro-categories.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				emptyState={
					<div className="flex flex-col items-center gap-2">
						<LayersIcon className="text-muted-foreground/40 size-8" />
						<div>
							<p className="text-muted-foreground font-medium">
								Nessuna macro categoria trovata
							</p>
							<p className="text-muted-foreground/60 text-sm">
								Crea la prima macro categoria per iniziare
							</p>
						</div>
					</div>
				}
			/>

			{data?.pagination &&
				data.pagination.total > 0 &&
				(() => {
					const totalPages = Math.ceil(data.pagination.total / limit);
					return (
						<div className="flex items-center justify-between">
							<div className="text-muted-foreground text-sm">
								Totale: {data.pagination.total} macro categori
								{data.pagination.total === 1 ? "a" : "e"}
							</div>
							<div className="flex items-center gap-4">
								<PageSizeSelector
									pageSize={limit}
									onPageSizeChange={(size) => {
										setLimit(size);
										setPage(1);
									}}
								/>
								<DataPagination
									page={page}
									totalPages={totalPages}
									onPageChange={setPage}
								/>
							</div>
						</div>
					);
				})()}

			<Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Nuova Macro Categoria Prodotto</DialogTitle>
						<DialogDescription>
							Inserisci il nome della nuova macro categoria prodotto.
						</DialogDescription>
					</DialogHeader>
					<ProductMacroCategoryForm
						onSubmit={(data) => createMutation.mutate(data.name)}
						onCancel={() => onCreateOpenChange(false)}
						isPending={createMutation.isPending}
						submitLabel="Crea"
						pendingLabel="Creazione..."
					/>
				</DialogContent>
			</Dialog>

			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Modifica Macro Categoria Prodotto</DialogTitle>
						<DialogDescription>
							Modifica il nome della macro categoria selezionata.
						</DialogDescription>
					</DialogHeader>
					<ProductMacroCategoryForm
						defaultValues={
							selectedMacro ? { name: selectedMacro.name } : undefined
						}
						onSubmit={(data) => {
							if (selectedMacro) {
								updateMutation.mutate({
									id: selectedMacro.id,
									name: data.name,
								});
							}
						}}
						onCancel={() => {
							setEditOpen(false);
							setSelectedMacro(null);
						}}
						isPending={updateMutation.isPending}
						submitLabel="Salva"
						pendingLabel="Salvataggio..."
					/>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Conferma eliminazione</AlertDialogTitle>
						<AlertDialogDescription>
							Sei sicuro di voler eliminare la macro categoria "
							{selectedMacro?.name}"? L'eliminazione fallirà se ci sono ancora
							sotto-categorie collegate.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => {
								setDeleteOpen(false);
								setSelectedMacro(null);
							}}
						>
							Annulla
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={handleDelete}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? "Eliminazione..." : "Elimina"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
