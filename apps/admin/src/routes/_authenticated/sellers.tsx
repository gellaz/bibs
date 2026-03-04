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
import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
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
import { CheckCircle2Icon, ShieldCheckIcon, XCircleIcon } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/sellers")({
	component: SellersPage,
	validateSearch: (search: Record<string, unknown>) => {
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
		};
	},
});

interface PendingSeller {
	id: string;
	userId: string;
	onboardingStatus: string;
	firstName: string | null;
	lastName: string | null;
	createdAt: string | Date;
	user: {
		id: string;
		name: string;
		email: string;
	};
	organization: {
		id: string;
		businessName: string;
		vatNumber: string;
		vatStatus: string;
	} | null;
}

function SellersPage() {
	const { page, limit } = Route.useSearch();
	const queryClient = useQueryClient();

	const [confirmAction, setConfirmAction] = useState<{
		type: "verify" | "reject";
		seller: PendingSeller;
	} | null>(null);

	const { data, isLoading, error } = useQuery({
		queryKey: ["admin-sellers-pending", page, limit],
		queryFn: async () => {
			const response = await api().admin.sellers.pending.get({
				query: { page, limit },
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento venditori",
				);
			}

			return response.data;
		},
	});

	const verifyMutation = useMutation({
		mutationFn: async (sellerId: string) => {
			const response = await api().admin.sellers({ sellerId }).verify.patch();

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nella verifica",
				);
			}

			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["admin-sellers-pending"],
			});
			setConfirmAction(null);
			toast.success("Venditore approvato con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'approvazione");
		},
	});

	const rejectMutation = useMutation({
		mutationFn: async (sellerId: string) => {
			const response = await api().admin.sellers({ sellerId }).reject.patch();

			if (response.error) {
				throw new Error(response.error.value?.message || "Errore nel rifiuto");
			}

			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["admin-sellers-pending"],
			});
			setConfirmAction(null);
			toast.success("Venditore rifiutato");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante il rifiuto");
		},
	});

	const handleConfirm = () => {
		if (!confirmAction) return;
		if (confirmAction.type === "verify") {
			verifyMutation.mutate(confirmAction.seller.id);
		} else {
			rejectMutation.mutate(confirmAction.seller.id);
		}
	};

	const isPending = verifyMutation.isPending || rejectMutation.isPending;
	const total = data?.pagination?.total ?? 0;

	return (
		<div className="space-y-4">
			<PageHeader
				title="Venditori"
				description="Gestisci le richieste di registrazione dei venditori"
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
								<TableHead className="pl-6">Venditore</TableHead>
								<TableHead>Email</TableHead>
								<TableHead>Azienda</TableHead>
								<TableHead>P.IVA</TableHead>
								<TableHead>Registrato il</TableHead>
								<TableHead className="pr-6 text-right">Azioni</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.data && data.data.length > 0 ? (
								data.data.map((seller: PendingSeller) => (
									<TableRow key={seller.id} className="group">
										<TableCell className="pl-6 font-semibold">
											{seller.firstName && seller.lastName
												? `${seller.firstName} ${seller.lastName}`
												: seller.user.name}
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{seller.user.email}
										</TableCell>
										<TableCell className="text-sm">
											{seller.organization?.businessName ?? (
												<span className="text-muted-foreground">—</span>
											)}
										</TableCell>
										<TableCell className="text-sm">
											{seller.organization ? (
												<div className="flex items-center gap-2">
													<code className="text-xs">
														{seller.organization.vatNumber}
													</code>
													<Badge variant="outline" className="text-xs">
														{seller.organization.vatStatus}
													</Badge>
												</div>
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{new Date(seller.createdAt).toLocaleDateString("it-IT", {
												year: "numeric",
												month: "long",
												day: "numeric",
											})}
										</TableCell>
										<TableCell className="pr-6 text-right">
											<div className="flex items-center justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													className="text-green-600 hover:text-green-700 hover:bg-green-50"
													onClick={() =>
														setConfirmAction({
															type: "verify",
															seller,
														})
													}
												>
													<CheckCircle2Icon className="size-4" />
													<span>Approva</span>
												</Button>
												<Button
													variant="ghost"
													size="sm"
													className="text-destructive hover:text-destructive hover:bg-destructive/10"
													onClick={() =>
														setConfirmAction({
															type: "reject",
															seller,
														})
													}
												>
													<XCircleIcon className="size-4" />
													<span>Rifiuta</span>
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow className="hover:bg-transparent">
									<TableCell colSpan={6} className="h-32 text-center">
										<div className="flex flex-col items-center gap-2">
											<ShieldCheckIcon className="text-muted-foreground/40 size-8" />
											<div>
												<p className="text-muted-foreground font-medium">
													Nessun venditore in attesa
												</p>
												<p className="text-muted-foreground/60 text-sm">
													Le nuove richieste appariranno qui
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

			{total > 0 && (
				<div className="text-muted-foreground flex items-center justify-between text-sm">
					<div>
						Pagina {page} di {Math.ceil(total / limit)}
					</div>
					<div>
						Totale: {total} venditor{total === 1 ? "e" : "i"} in attesa
					</div>
				</div>
			)}

			{/* Confirm Action Dialog */}
			<AlertDialog
				open={!!confirmAction}
				onOpenChange={(open) => {
					if (!open) setConfirmAction(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirmAction?.type === "verify"
								? "Approva venditore"
								: "Rifiuta venditore"}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmAction?.type === "verify" ? (
								<>
									Sei sicuro di voler approvare{" "}
									<strong>
										{confirmAction.seller.organization?.businessName ??
											confirmAction.seller.user.name}
									</strong>
									? Il venditore potrà iniziare a operare sulla piattaforma.
								</>
							) : (
								<>
									Sei sicuro di voler rifiutare{" "}
									<strong>
										{confirmAction?.seller.organization?.businessName ??
											confirmAction?.seller.user.name}
									</strong>
									? Il venditore dovrà aggiornare i dati e ripresentare la
									richiesta.
								</>
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isPending}>Annulla</AlertDialogCancel>
						<AlertDialogAction
							variant={
								confirmAction?.type === "verify" ? "default" : "destructive"
							}
							onClick={handleConfirm}
							disabled={isPending}
						>
							{isPending
								? "Attendere..."
								: confirmAction?.type === "verify"
									? "Approva"
									: "Rifiuta"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
