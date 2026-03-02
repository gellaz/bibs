import { Badge } from "@bibs/ui/components/badge";
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
import { Textarea } from "@bibs/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	GlobeIcon,
	PhoneIcon,
	PlusIcon,
	StoreIcon,
	Trash2Icon,
} from "lucide-react";
import { useState } from "react";
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

type PhoneNumber = { label: string; number: string };

function StoresPage() {
	const { page, limit } = Route.useSearch();
	const queryClient = useQueryClient();
	const [createOpen, setCreateOpen] = useState(false);
	const [phones, setPhones] = useState<PhoneNumber[]>([]);

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
		mutationFn: async (formData: {
			name: string;
			description?: string;
			addressLine1: string;
			addressLine2?: string;
			city: string;
			zipCode: string;
			province?: string;
			country?: string;
			websiteUrl?: string;
			phoneNumbers?: Array<{
				label?: string;
				number: string;
				position?: number;
			}>;
		}) => {
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
			setPhones([]);
			toast.success("Negozio creato con successo");
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
		const addressLine1 = (fd.get("addressLine1") as string).trim();
		const addressLine2 = (fd.get("addressLine2") as string).trim() || undefined;
		const city = (fd.get("city") as string).trim();
		const zipCode = (fd.get("zipCode") as string).trim();
		const province = (fd.get("province") as string).trim() || undefined;
		const websiteUrl = (fd.get("websiteUrl") as string).trim() || undefined;

		if (!name || !addressLine1 || !city || !zipCode) return;

		const phoneNumbers = phones
			.filter((p) => p.number.trim())
			.map((p, idx) => ({
				label: p.label.trim() || undefined,
				number: p.number.trim(),
				position: idx,
			}));

		createMutation.mutate({
			name,
			description,
			addressLine1,
			addressLine2,
			city,
			zipCode,
			province,
			websiteUrl,
			phoneNumbers: phoneNumbers.length > 0 ? phoneNumbers : undefined,
		});
	};

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
					<form onSubmit={handleCreate}>
						<DialogHeader>
							<DialogTitle>Nuovo Negozio</DialogTitle>
							<DialogDescription>
								Inserisci i dati del nuovo punto vendita.
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="store-name">Nome *</Label>
								<Input
									id="store-name"
									name="name"
									placeholder="Es. Bottega del Gusto"
									required
									autoFocus
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="store-description">Descrizione</Label>
								<Textarea
									id="store-description"
									name="description"
									placeholder="Descrizione del negozio (opzionale)"
									rows={2}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="store-address1">Indirizzo *</Label>
								<Input
									id="store-address1"
									name="addressLine1"
									placeholder="Via Roma 1"
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="store-address2">Indirizzo (riga 2)</Label>
								<Input
									id="store-address2"
									name="addressLine2"
									placeholder="Interno, piano, scala (opzionale)"
								/>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="store-city">Città *</Label>
									<Input
										id="store-city"
										name="city"
										placeholder="Milano"
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="store-zip">CAP *</Label>
									<Input
										id="store-zip"
										name="zipCode"
										placeholder="20100"
										required
									/>
								</div>
							</div>

							<div className="space-y-2">
								<Label htmlFor="store-province">Provincia</Label>
								<Input
									id="store-province"
									name="province"
									placeholder="MI (opzionale)"
									maxLength={2}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="store-website">Sito web</Label>
								<Input
									id="store-website"
									name="websiteUrl"
									type="url"
									placeholder="https://esempio.it (opzionale)"
								/>
							</div>

							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label>Numeri di telefono</Label>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() =>
											setPhones([...phones, { label: "", number: "" }])
										}
									>
										<PlusIcon className="size-3" />
										<span>Aggiungi</span>
									</Button>
								</div>
								{phones.map((phone, idx) => (
									<div key={idx} className="flex gap-2">
										<Input
											placeholder="Etichetta (es. Principale)"
											value={phone.label}
											onChange={(e) => {
												const newPhones = [...phones];
												newPhones[idx].label = e.target.value;
												setPhones(newPhones);
											}}
											className="w-1/3"
										/>
										<Input
											placeholder="Numero di telefono"
											type="tel"
											value={phone.number}
											onChange={(e) => {
												const newPhones = [...phones];
												newPhones[idx].number = e.target.value;
												setPhones(newPhones);
											}}
											className="flex-1"
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											onClick={() =>
												setPhones(phones.filter((_, i) => i !== idx))
											}
										>
											<Trash2Icon className="size-4" />
										</Button>
									</div>
								))}
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
								{createMutation.isPending ? "Creazione..." : "Crea Negozio"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
