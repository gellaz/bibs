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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PencilIcon, PlusIcon, TagsIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/categories")({
	component: CategoriesPage,
	validateSearch: (search: Record<string, unknown>) => {
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
		};
	},
});

interface Category {
	id: string;
	name: string;
	createdAt: Date | string;
	updatedAt: Date | string;
}

function CategoriesPage() {
	const { page, limit } = Route.useSearch();
	const queryClient = useQueryClient();

	const [createOpen, setCreateOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [selectedCategory, setSelectedCategory] = useState<Category | null>(
		null,
	);

	// Fetch categories
	const { data, isLoading, error } = useQuery({
		queryKey: ["categories", page, limit],
		queryFn: async () => {
			const response = await api().categories.get({
				query: { page, limit },
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Failed to fetch categories",
				);
			}

			return response.data;
		},
	});

	// Create mutation
	const createMutation = useMutation({
		mutationFn: async (name: string) => {
			const response = await api().admin.categories.post({
				name,
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Failed to create category",
				);
			}

			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["categories"] });
			setCreateOpen(false);
			toast.success("Categoria creata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante la creazione");
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: async ({ id, name }: { id: string; name: string }) => {
			const response = await api().admin.categories({ categoryId: id }).patch({
				name,
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Failed to update category",
				);
			}

			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["categories"] });
			setEditOpen(false);
			setSelectedCategory(null);
			toast.success("Categoria aggiornata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'aggiornamento");
		},
	});

	// Delete mutation
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
			void queryClient.invalidateQueries({ queryKey: ["categories"] });
			setDeleteOpen(false);
			setSelectedCategory(null);
			toast.success("Categoria eliminata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'eliminazione");
		},
	});

	const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const name = formData.get("name") as string;
		if (name.trim()) {
			createMutation.mutate(name.trim());
		}
	};

	const handleEdit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!selectedCategory) return;
		const formData = new FormData(e.currentTarget);
		const name = formData.get("name") as string;
		if (name.trim()) {
			updateMutation.mutate({ id: selectedCategory.id, name: name.trim() });
		}
	};

	const handleDelete = () => {
		if (!selectedCategory) return;
		deleteMutation.mutate(selectedCategory.id);
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Categorie Prodotto</h1>
					<p className="text-muted-foreground text-sm">
						Gestisci le categorie dei prodotti
					</p>
				</div>
				<Button onClick={() => setCreateOpen(true)}>
					<PlusIcon />
					<span>Nuova Categoria</span>
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
								<TableHead className="w-[40%] pl-6">Nome</TableHead>
								<TableHead className="w-[40%]">Data Creazione</TableHead>
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

			{data?.pagination && data.pagination.total > 0 && (
				<div className="text-muted-foreground flex items-center justify-between text-sm">
					<div>
						Pagina {page} di {Math.ceil(data.pagination.total / limit)}
					</div>
					<div>
						Totale: {data.pagination.total} categori
						{data.pagination.total === 1 ? "a" : "e"}
					</div>
				</div>
			)}

			{/* Create Dialog */}
			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent>
					<form onSubmit={handleCreate}>
						<DialogHeader>
							<DialogTitle>Nuova Categoria</DialogTitle>
							<DialogDescription>
								Inserisci il nome della nuova categoria prodotto.
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="create-name">Nome</Label>
								<Input
									id="create-name"
									name="name"
									placeholder="Es. Elettronica"
									required
									autoFocus
								/>
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
							<Button type="submit" disabled={createMutation.isPending}>
								{createMutation.isPending ? "Creazione..." : "Crea"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Edit Dialog */}
			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent>
					<form onSubmit={handleEdit}>
						<DialogHeader>
							<DialogTitle>Modifica Categoria</DialogTitle>
							<DialogDescription>
								Modifica il nome della categoria selezionata.
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="edit-name">Nome</Label>
								<Input
									id="edit-name"
									name="name"
									defaultValue={selectedCategory?.name || ""}
									required
									autoFocus
								/>
							</div>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									setEditOpen(false);
									setSelectedCategory(null);
								}}
							>
								Annulla
							</Button>
							<Button type="submit" disabled={updateMutation.isPending}>
								{updateMutation.isPending ? "Salvataggio..." : "Salva"}
							</Button>
						</DialogFooter>
					</form>
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
