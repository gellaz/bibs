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
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2Icon, ShieldCheckIcon, XCircleIcon } from "lucide-react";
import { useState } from "react";
import { OnboardingStatusBadge } from "@/components/onboarding-status-badge";
import { PageHeader } from "@/components/page-header";
import { type TabItem, TabNav } from "@/components/tab-nav";
import { api } from "@/lib/api";

type SellerStatus = "pending_review" | "active" | "rejected";

const STATUS_TABS = [
	{ value: "all", label: "Tutte", badgeColor: "default" },
	{ value: "pending_review", label: "In revisione", badgeColor: "amber" },
	{ value: "active", label: "Approvate", badgeColor: "emerald" },
	{ value: "rejected", label: "Rifiutate", badgeColor: "red" },
] as const;

export const Route = createFileRoute("/_authenticated/sellers/")({
	component: SellersPage,
	validateSearch: (search: Record<string, unknown>) => ({
		page: Number(search.page ?? 1),
		limit: Number(search.limit ?? 20),
		status: (search.status as string) || undefined,
	}),
});

interface Seller {
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
	const { page, limit, status } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const queryClient = useQueryClient();

	const [confirmAction, setConfirmAction] = useState<{
		type: "verify" | "reject";
		seller: Seller;
	} | null>(null);

	const activeTab = status ?? "all";

	const { data: countsData } = useQuery({
		queryKey: ["admin-sellers-counts"],
		queryFn: async () => {
			const response = await api().admin.sellers.counts.get();
			if (response.error) return null;
			return response.data?.data ?? null;
		},
	});

	const { data, isLoading, error } = useQuery({
		queryKey: ["admin-sellers", status, page, limit],
		queryFn: async () => {
			const response = await api().admin.sellers.get({
				query: {
					page,
					limit,
					...(status ? { status: status as SellerStatus } : {}),
				},
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
				queryKey: ["admin-sellers"],
			});
			void queryClient.invalidateQueries({
				queryKey: ["admin-sellers-counts"],
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
				queryKey: ["admin-sellers"],
			});
			void queryClient.invalidateQueries({
				queryKey: ["admin-sellers-counts"],
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

	const handleTabChange = (value: string) => {
		void navigate({
			search: {
				page: 1,
				limit,
				status: value === "all" ? undefined : value,
			},
		});
	};

	const isMutating = verifyMutation.isPending || rejectMutation.isPending;
	const total = data?.pagination?.total ?? 0;

	// Show actions column when viewing all statuses or specifically pending_review
	const showActions = !status || status === "pending_review";

	const sellerTabs: TabItem[] = STATUS_TABS.map((tab) => ({
		value: tab.value,
		label: tab.label,
		badgeColor: tab.badgeColor,
		count:
			tab.value === "all"
				? countsData
					? (countsData.pending_review ?? 0) +
						(countsData.active ?? 0) +
						(countsData.rejected ?? 0)
					: null
				: countsData
					? (countsData[tab.value as keyof typeof countsData] ?? 0)
					: null,
	}));

	return (
		<div className="space-y-4">
			<PageHeader
				title="Venditori"
				description="Gestisci le candidature dei venditori"
			/>

			<TabNav
				tabs={sellerTabs}
				activeTab={activeTab}
				onTabChange={handleTabChange}
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
								{!status && <TableHead>Stato</TableHead>}
								<TableHead>Registrato il</TableHead>
								{showActions && (
									<TableHead className="pr-6 text-right">Azioni</TableHead>
								)}
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.data && data.data.length > 0 ? (
								data.data.map((seller: Seller) => (
									<TableRow key={seller.id} className="group">
										<TableCell className="pl-6 font-semibold">
											<Link
												to="/sellers/$sellerId"
												params={{ sellerId: seller.id }}
												className="hover:text-primary hover:underline"
											>
												{seller.firstName && seller.lastName
													? `${seller.firstName} ${seller.lastName}`
													: seller.user.name}
											</Link>
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
												<code className="text-xs">
													{seller.organization.vatNumber}
												</code>
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</TableCell>
										{!status && (
											<TableCell>
												<OnboardingStatusBadge
													status={seller.onboardingStatus}
												/>
											</TableCell>
										)}
										<TableCell className="text-muted-foreground text-sm">
											{new Date(seller.createdAt).toLocaleDateString("it-IT", {
												year: "numeric",
												month: "long",
												day: "numeric",
											})}
										</TableCell>
										{showActions && (
											<TableCell className="pr-6 text-right">
												{seller.onboardingStatus === "pending_review" ? (
													<div className="flex items-center justify-end gap-1.5">
														<Button
															variant="success"
															size="sm"
															onClick={() =>
																setConfirmAction({
																	type: "verify",
																	seller,
																})
															}
														>
															<CheckCircle2Icon className="size-3.5" />
															Approva
														</Button>
														<Button
															variant="destructive"
															size="sm"
															onClick={() =>
																setConfirmAction({
																	type: "reject",
																	seller,
																})
															}
														>
															<XCircleIcon className="size-3.5" />
															Rifiuta
														</Button>
													</div>
												) : null}
											</TableCell>
										)}
									</TableRow>
								))
							) : (
								<TableRow className="hover:bg-transparent">
									<TableCell
										colSpan={showActions ? 7 : 6}
										className="h-32 text-center"
									>
										<div className="flex flex-col items-center gap-2">
											<ShieldCheckIcon className="text-muted-foreground/40 size-8" />
											<div>
												<p className="text-muted-foreground font-medium">
													Nessun venditore trovato
												</p>
												<p className="text-muted-foreground/60 text-sm">
													{status === "pending_review"
														? "Nessuna candidatura in attesa di revisione"
														: status === "rejected"
															? "Nessuna candidatura rifiutata"
															: status === "active"
																? "Nessun venditore attivo"
																: "Le nuove candidature appariranno qui"}
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
						Totale: {total} venditor{total === 1 ? "e" : "i"}
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
						<AlertDialogCancel disabled={isMutating}>Annulla</AlertDialogCancel>
						<AlertDialogAction
							variant={
								confirmAction?.type === "verify" ? "success" : "destructive"
							}
							onClick={handleConfirm}
							disabled={isMutating}
						>
							{isMutating
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
