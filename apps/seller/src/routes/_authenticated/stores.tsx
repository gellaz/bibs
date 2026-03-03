import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
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
import { GlobeIcon, PhoneIcon, PlusIcon, StoreIcon } from "lucide-react";
import { useState } from "react";
import { StoreForm } from "@/features/stores/components/store-form";
import type { StoreFormData } from "@/features/stores/schemas/store";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/stores")({
	component: StoresPage,
	validateSearch: (search: Record<string, unknown>) => {
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
		};
	},
});

function StoresPage() {
	const { page, limit } = Route.useSearch();
	const queryClient = useQueryClient();
	const [createOpen, setCreateOpen] = useState(false);

	const { data, isLoading, error } = useQuery({
		queryKey: ["stores", page, limit],
		queryFn: async () => {
			const response = await api().seller.stores.get({
				query: { page, limit },
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento negozi",
				);
			}

			return response.data;
		},
	});

	const createMutation = useMutation({
		mutationFn: async (formData: StoreFormData) => {
			const response = await api().seller.stores.post(formData);

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nella creazione",
				);
			}

			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["stores"] });
			setCreateOpen(false);
			toast.success("Negozio creato con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante la creazione");
		},
	});

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Negozi</h1>
					<p className="text-muted-foreground text-sm">
						Gestisci i tuoi punti vendita
					</p>
				</div>
				<Button onClick={() => setCreateOpen(true)}>
					<PlusIcon />
					<span>Nuovo Negozio</span>
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
								<TableHead className="w-[30%] pl-6">Nome</TableHead>
								<TableHead className="w-[30%]">Indirizzo</TableHead>
								<TableHead className="w-[20%]">Contatti</TableHead>
								<TableHead className="w-[20%] pr-6 text-right">Stato</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.data && data.data.length > 0 ? (
								data.data.map((store) => (
									<TableRow key={store.id} className="group">
										<TableCell className="pl-6 font-semibold">
											{store.name}
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{[store.addressLine1, store.city]
												.filter(Boolean)
												.join(", ") || "—"}
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											<div className="flex flex-col gap-1">
												{store.phoneNumbers && store.phoneNumbers.length > 0 ? (
													<div className="flex items-center gap-1">
														<PhoneIcon className="size-3" />
														<span>{store.phoneNumbers[0].number}</span>
														{store.phoneNumbers.length > 1 && (
															<Badge variant="outline" className="text-xs">
																+{store.phoneNumbers.length - 1}
															</Badge>
														)}
													</div>
												) : null}
												{store.websiteUrl && (
													<div className="flex items-center gap-1">
														<GlobeIcon className="size-3" />
														<span className="truncate max-w-[150px]">
															{store.websiteUrl.replace(/^https?:\/\//, "")}
														</span>
													</div>
												)}
											</div>
										</TableCell>
										<TableCell className="pr-6 text-right text-sm text-muted-foreground">
											Attivo
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow className="hover:bg-transparent">
									<TableCell colSpan={4} className="h-32 text-center">
										<div className="flex flex-col items-center gap-2">
											<StoreIcon className="text-muted-foreground/40 size-8" />
											<div>
												<p className="text-muted-foreground font-medium">
													Nessun negozio trovato
												</p>
												<p className="text-muted-foreground/60 text-sm">
													I tuoi negozi appariranno qui
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
						Totale: {data.pagination.total} negoz
						{data.pagination.total === 1 ? "io" : "i"}
					</div>
				</div>
			)}

			{/* Create Store Dialog */}
			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Nuovo Negozio</DialogTitle>
						<DialogDescription>
							Inserisci i dati del nuovo punto vendita.
						</DialogDescription>
					</DialogHeader>
					<StoreForm
						onSubmit={(data) => createMutation.mutate(data)}
						onCancel={() => setCreateOpen(false)}
						isPending={createMutation.isPending}
					/>
				</DialogContent>
			</Dialog>
		</div>
	);
}
