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
import {
	PencilIcon,
	SearchIcon,
	StoreIcon,
	Trash2Icon,
	UploadIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	CsvImportDialog,
	type CsvImportResult,
} from "@/features/csv-import/components/csv-import-dialog";
import { StoreCategoryForm } from "@/features/store-categories/components/store-category-form";
import { api } from "@/lib/api";

interface StoreCategory {
	id: string;
	name: string;
	createdAt: Date | string;
	updatedAt: Date | string;
}

interface StoreCategoriesPanelProps {
	createOpen: boolean;
	onCreateOpenChange: (open: boolean) => void;
}

type SortByField = "name" | "createdAt";

const DATE_FMT_OPTS: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "long",
	day: "numeric",
};

export function StoreCategoriesPanel({
	createOpen,
	onCreateOpenChange,
}: StoreCategoriesPanelProps) {
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
	const [importOpen, setImportOpen] = useState(false);
	const [selectedCategory, setSelectedCategory] =
		useState<StoreCategory | null>(null);

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
			"store-categories",
			page,
			limit,
			debouncedSearch,
			sortBy,
			sortOrder,
		],
		queryFn: async () => {
			const response = await api()["store-categories"].get({
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
					response.error.value?.message || "Failed to fetch store categories",
				);
			}

			return response.data;
		},
	});

	const invalidateAll = () => {
		void queryClient.invalidateQueries({ queryKey: ["store-categories"] });
		void queryClient.invalidateQueries({
			queryKey: ["admin-configurations-counts"],
		});
	};

	const createMutation = useMutation({
		mutationFn: async (name: string) => {
			const response = await api().admin["store-categories"].post({ name });
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Failed to create store category",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateAll();
			onCreateOpenChange(false);
			toast.success("Categoria negozio creata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante la creazione");
		},
	});

	const updateMutation = useMutation({
		mutationFn: async ({ id, name }: { id: string; name: string }) => {
			const response = await api()
				.admin["store-categories"]({ categoryId: id })
				.patch({ name });
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Failed to update store category",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateAll();
			setEditOpen(false);
			setSelectedCategory(null);
			toast.success("Categoria negozio aggiornata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'aggiornamento");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const response = await api()
				.admin["store-categories"]({ categoryId: id })
				.delete();
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Failed to delete store category",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateAll();
			setDeleteOpen(false);
			setSelectedCategory(null);
			toast.success("Categoria negozio eliminata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'eliminazione");
		},
	});

	const handleDelete = () => {
		if (!selectedCategory) return;
		deleteMutation.mutate(selectedCategory.id);
	};

	const handleImport = async (file: File): Promise<CsvImportResult> => {
		const response = await api().admin["store-categories"].import.post({
			file,
		});
		if (response.error) {
			throw new Error(
				response.error.value?.message || "Errore durante l'import",
			);
		}
		const data = response.data?.data;
		if (!data) throw new Error("Risposta non valida dal server");
		return data;
	};

	const rows = useMemo<StoreCategory[]>(
		() => (data?.data as StoreCategory[]) ?? [],
		[data],
	);

	const columns = useMemo<ColumnDef<StoreCategory>[]>(
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
								setSelectedCategory(row.original);
								setEditOpen(true);
							}}
							aria-label="Modifica categoria"
						>
							<PencilIcon className="size-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => {
								setSelectedCategory(row.original);
								setDeleteOpen(true);
							}}
							aria-label="Elimina categoria"
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

			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
					<Input
						placeholder="Cerca categoria negozio..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="pl-9"
					/>
				</div>
				<Button variant="outline" onClick={() => setImportOpen(true)}>
					<UploadIcon />
					<span>Importa CSV</span>
				</Button>
			</div>

			<DataTable
				data={rows}
				columns={columns}
				storageKey="admin.store-categories.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				emptyState={
					<div className="flex flex-col items-center gap-2">
						<StoreIcon className="text-muted-foreground/40 size-8" />
						<div>
							<p className="text-muted-foreground font-medium">
								Nessuna categoria negozio trovata
							</p>
							<p className="text-muted-foreground/60 text-sm">
								Crea la prima categoria per iniziare
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
								Totale: {data.pagination.total} categori
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
						<DialogTitle>Nuova Categoria Negozio</DialogTitle>
						<DialogDescription>
							Inserisci il nome della nuova categoria negozio.
						</DialogDescription>
					</DialogHeader>
					<StoreCategoryForm
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
						<DialogTitle>Modifica Categoria Negozio</DialogTitle>
						<DialogDescription>
							Modifica il nome della categoria selezionata.
						</DialogDescription>
					</DialogHeader>
					<StoreCategoryForm
						defaultValues={
							selectedCategory ? { name: selectedCategory.name } : undefined
						}
						onSubmit={(data) => {
							if (selectedCategory) {
								updateMutation.mutate({
									id: selectedCategory.id,
									name: data.name,
								});
							}
						}}
						onCancel={() => {
							setEditOpen(false);
							setSelectedCategory(null);
						}}
						isPending={updateMutation.isPending}
						submitLabel="Salva"
						pendingLabel="Salvataggio..."
					/>
				</DialogContent>
			</Dialog>

			<CsvImportDialog
				open={importOpen}
				onOpenChange={setImportOpen}
				title="Importa Categorie Negozio"
				description="Carica un file CSV per popolare in blocco le categorie negozio."
				formatHint="Header atteso: name. L'import è idempotente: le categorie già presenti vengono saltate."
				onImport={handleImport}
				onSuccess={invalidateAll}
			/>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Conferma eliminazione</AlertDialogTitle>
						<AlertDialogDescription>
							Sei sicuro di voler eliminare la categoria "
							{selectedCategory?.name}"? Questa azione non può essere annullata.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => {
								setDeleteOpen(false);
								setSelectedCategory(null);
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
