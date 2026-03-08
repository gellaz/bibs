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
import { SortableTableHead } from "@bibs/ui/components/sortable-table-head";
import { Spinner } from "@bibs/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, SearchIcon, TagsIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CategoryForm } from "@/features/categories/components/category-form";
import { api } from "@/lib/api";

interface Category {
	id: string;
	name: string;
	createdAt: Date | string;
	updatedAt: Date | string;
}

interface CategoriesPanelProps {
	createOpen: boolean;
	onCreateOpenChange: (open: boolean) => void;
}

type SortByField = "name" | "createdAt";

export function CategoriesPanel({
	createOpen,
	onCreateOpenChange,
}: CategoriesPanelProps) {
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(20);
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [sortBy, setSortBy] = useState<SortByField>("name");
	const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
	const queryClient = useQueryClient();
	const [editOpen, setEditOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [selectedCategory, setSelectedCategory] = useState<Category | null>(
		null,
	);

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
		queryKey: ["categories", page, limit, debouncedSearch, sortBy, sortOrder],
		queryFn: async () => {
			const response = await api().categories.get({
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
					response.error.value?.message || "Failed to fetch categories",
				);
			}

			return response.data;
		},
	});

	const invalidateAll = () => {
		void queryClient.invalidateQueries({ queryKey: ["categories"] });
		void queryClient.invalidateQueries({
			queryKey: ["admin-configurations-counts"],
		});
	};

	const createMutation = useMutation({
		mutationFn: async (name: string) => {
			const response = await api().admin.categories.post({ name });

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Failed to create category",
				);
			}

			return response.data;
		},
		onSuccess: () => {
			invalidateAll();
			onCreateOpenChange(false);
			toast.success("Categoria creata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante la creazione");
		},
	});

	const updateMutation = useMutation({
		mutationFn: async ({ id, name }: { id: string; name: string }) => {
			const response = await api()
				.admin.categories({ categoryId: id })
				.patch({ name });

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Failed to update category",
				);
			}

			return response.data;
		},
		onSuccess: () => {
			invalidateAll();
			setEditOpen(false);
			setSelectedCategory(null);
			toast.success("Categoria aggiornata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'aggiornamento");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const response = await api()
				.admin.categories({ categoryId: id })
				.delete();

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Failed to delete category",
				);
			}

			return response.data;
		},
		onSuccess: () => {
			invalidateAll();
			setDeleteOpen(false);
			setSelectedCategory(null);
			toast.success("Categoria eliminata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'eliminazione");
		},
	});

	const handleDelete = () => {
		if (!selectedCategory) return;
		deleteMutation.mutate(selectedCategory.id);
	};

	return (
		<div className="space-y-4">
			{error && (
				<div className="bg-destructive/10 text-destructive rounded-lg border border-destructive/20 p-4">
					<p className="text-sm">
						Errore nel caricamento: {(error as Error).message}
					</p>
				</div>
			)}

			<div className="relative">
				<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
				<Input
					placeholder="Cerca categoria..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="pl-9"
				/>
			</div>

			{isLoading ? (
				<div className="bg-card flex h-64 items-center justify-center rounded-lg border">
					<Spinner className="size-8" />
				</div>
			) : (
				<div className="bg-card overflow-hidden rounded-lg border shadow-sm">
					<Table>
						<TableHeader>
							<TableRow className="bg-muted/50 hover:bg-muted/50">
								<SortableTableHead
									className="w-[40%] pl-4"
									active={sortBy === "name"}
									sortOrder={sortOrder}
									onSort={() => handleSort("name")}
								>
									Nome
								</SortableTableHead>
								<SortableTableHead
									className="w-[40%]"
									active={sortBy === "createdAt"}
									sortOrder={sortOrder}
									onSort={() => handleSort("createdAt")}
								>
									Data Creazione
								</SortableTableHead>
								<TableHead className="w-[20%] pr-6 text-right">
									Azioni
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.data && data.data.length > 0 ? (
								data.data.map((category: Category) => (
									<TableRow key={category.id} className="group">
										<TableCell className="pl-6 font-semibold">
											{category.name}
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{new Date(category.createdAt).toLocaleDateString(
												"it-IT",
												{
													year: "numeric",
													month: "long",
													day: "numeric",
												},
											)}
										</TableCell>
										<TableCell className="pr-6 text-right">
											<div className="flex items-center justify-end gap-1">
												<Button
													variant="ghost"
													size="icon-sm"
													onClick={() => {
														setSelectedCategory(category);
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
														setSelectedCategory(category);
														setDeleteOpen(true);
													}}
													aria-label="Elimina categoria"
												>
													<Trash2Icon className="size-4" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow className="hover:bg-transparent">
									<TableCell colSpan={3} className="h-32 text-center">
										<div className="flex flex-col items-center gap-2">
											<TagsIcon className="text-muted-foreground/40 size-8" />
											<div>
												<p className="text-muted-foreground font-medium">
													Nessuna categoria trovata
												</p>
												<p className="text-muted-foreground/60 text-sm">
													Crea la prima categoria per iniziare
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

			{/* Create Dialog */}
			<Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Nuova Categoria</DialogTitle>
						<DialogDescription>
							Inserisci il nome della nuova categoria prodotto.
						</DialogDescription>
					</DialogHeader>
					<CategoryForm
						onSubmit={(data) => createMutation.mutate(data.name)}
						onCancel={() => onCreateOpenChange(false)}
						isPending={createMutation.isPending}
						submitLabel="Crea"
						pendingLabel="Creazione..."
					/>
				</DialogContent>
			</Dialog>

			{/* Edit Dialog */}
			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Modifica Categoria</DialogTitle>
						<DialogDescription>
							Modifica il nome della categoria selezionata.
						</DialogDescription>
					</DialogHeader>
					<CategoryForm
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

			{/* Delete Confirmation */}
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
