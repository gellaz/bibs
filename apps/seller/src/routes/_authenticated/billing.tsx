import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
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
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download, MoreVerticalIcon } from "lucide-react";
import { useEffect } from "react";
import { SectionHeader } from "@/components/section-header";
import { CancelStoreDialog } from "@/features/billing/components/cancel-store-dialog";
import { useIsOwner } from "@/hooks/use-is-owner";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/billing")({
	component: BillingPage,
});

const STATUS_BADGE: Record<
	string,
	{
		label: string;
		variant: "default" | "secondary" | "destructive" | "outline";
	}
> = {
	active: { label: "Attivo", variant: "default" },
	past_due: { label: "Rinnovo fallito", variant: "destructive" },
	canceling: { label: "In cancellazione", variant: "outline" },
	suspended: { label: "Sospeso", variant: "destructive" },
};

function formatEuro(cents: number): string {
	return `€${(cents / 100).toFixed(2)}`;
}

const dateFormatter = new Intl.DateTimeFormat("it-IT", {
	day: "numeric",
	month: "long",
	year: "numeric",
});

const dateFormatterShort = new Intl.DateTimeFormat("it-IT", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

function formatDate(d: Date | string, short = false): string {
	return short
		? dateFormatterShort.format(new Date(d))
		: dateFormatter.format(new Date(d));
}

const invoiceDateFormatter = new Intl.DateTimeFormat("it-IT", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

function formatInvoiceDate(d: Date | string): string {
	return invoiceDateFormatter.format(new Date(d));
}

function BillingPage() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const isOwner = useIsOwner();

	// Billing is owner-only (the API enforces requireOwner on every endpoint).
	// Employees who deep-link here are redirected home; queries stay disabled so
	// they never fire a request that would 403.
	useEffect(() => {
		if (!isOwner) void navigate({ to: "/" });
	}, [isOwner, navigate]);

	const { data: summary, isLoading: summaryLoading } = useQuery({
		queryKey: ["seller", "billing", "summary"],
		enabled: isOwner,
		queryFn: async () => {
			const r = await api().seller.billing.summary.get();
			if (r.error) throw new Error((r.error.value as any)?.message);
			return r.data?.data;
		},
	});

	const { data: subs, isLoading: subsLoading } = useQuery({
		queryKey: ["seller", "billing", "subscriptions"],
		enabled: isOwner,
		queryFn: async () => {
			const r = await api().seller.billing.subscriptions.get();
			if (r.error) throw new Error((r.error.value as any)?.message);
			return r.data?.data ?? [];
		},
	});

	const { data: invoicesPage, isLoading: invoicesLoading } = useQuery({
		queryKey: ["seller", "billing", "invoices"],
		enabled: isOwner,
		queryFn: async () => {
			const r = await api().seller.billing.invoices.get({
				query: { limit: 25 },
			});
			if (r.error) throw new Error((r.error.value as any)?.message);
			return r.data?.data;
		},
	});

	const portalMutation = useMutation({
		mutationFn: async () => {
			const r = await api().seller.billing.portal.post();
			if (r.error) throw new Error((r.error.value as any)?.message);
			return r.data?.data;
		},
		onSuccess: (data) => {
			if (data?.url) window.location.href = data.url;
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const reactivateMutation = useMutation({
		mutationFn: async (storeId: string) => {
			const r = await api().seller.stores({ storeId }).reactivate.post();
			if (r.error) throw new Error((r.error.value as any)?.message);
			return r.data?.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["seller", "billing"] });
			toast.success("Cancellazione annullata");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className="space-y-6">
			<SectionHeader
				title="Billing"
				subtitle="Riepilogo dei pagamenti e dei rinnovi"
			/>

			<Card>
				<CardHeader>
					<CardTitle>Riepilogo</CardTitle>
					<CardDescription>
						I tuoi negozi attivi e i prossimi rinnovi.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{summaryLoading || !summary ? (
						<Spinner />
					) : summary.activeStoresCount === 0 ? (
						<p className="text-muted-foreground text-sm">
							Non hai ancora negozi attivi.
						</p>
					) : (
						<div className="flex flex-col gap-4">
							<p className="text-base">
								Stai pagando{" "}
								<strong>{formatEuro(summary.totalMonthlyCents)}/mese</strong>{" "}
								per <strong>{summary.activeStoresCount}</strong>{" "}
								{summary.activeStoresCount === 1
									? "negozio attivo"
									: "negozi attivi"}
								.
							</p>
							{summary.nextRenewal && (
								<p className="text-muted-foreground text-sm">
									Prossimo rinnovo:{" "}
									<strong>{formatDate(summary.nextRenewal.date)}</strong> per{" "}
									<strong>{summary.nextRenewal.storeName}</strong> (
									{formatEuro(summary.nextRenewal.amountCents)}).
								</p>
							)}
							<div>
								<Button
									variant="outline"
									onClick={() => portalMutation.mutate()}
									disabled={portalMutation.isPending}
								>
									{portalMutation.isPending ? (
										<Spinner />
									) : (
										"Gestisci pagamenti su Stripe"
									)}
								</Button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Abbonamenti per negozio</CardTitle>
				</CardHeader>
				<CardContent>
					{subsLoading ? (
						<Spinner />
					) : !subs || subs.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							Nessun abbonamento attivo.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Negozio</TableHead>
									<TableHead>Stato</TableHead>
									<TableHead>Quota</TableHead>
									<TableHead>Prossimo rinnovo</TableHead>
									<TableHead className="w-10" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{subs.map((s) => {
									const badge = STATUS_BADGE[s.status] ?? {
										label: s.status,
										variant: "outline" as const,
									};
									const periodLabel =
										s.status === "suspended"
											? `Scaduto il ${formatDate(s.currentPeriodEnd, true)}`
											: s.status === "canceling"
												? `Disattivazione ${formatDate(s.currentPeriodEnd, true)}`
												: formatDate(s.currentPeriodEnd, true);
									return (
										<TableRow key={s.storeId}>
											<TableCell>{s.storeName}</TableCell>
											<TableCell>
												<Badge variant={badge.variant}>{badge.label}</Badge>
											</TableCell>
											<TableCell>{formatEuro(s.feeAmountCents)}/mese</TableCell>
											<TableCell>{periodLabel}</TableCell>
											<TableCell>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															variant="ghost"
															size="icon"
															aria-label="Azioni"
														>
															<MoreVerticalIcon className="h-4 w-4" />
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuItem
															onSelect={() => portalMutation.mutate()}
														>
															Gestisci pagamento
														</DropdownMenuItem>
														{(s.status === "active" ||
															s.status === "past_due" ||
															s.status === "suspended") && (
															<CancelStoreDialog
																storeId={s.storeId}
																storeName={s.storeName}
																status={
																	s.status as
																		| "active"
																		| "past_due"
																		| "suspended"
																}
																currentPeriodEnd={s.currentPeriodEnd}
																trigger={
																	<DropdownMenuItem
																		variant="destructive"
																		onSelect={(e) => e.preventDefault()}
																	>
																		Cancella
																	</DropdownMenuItem>
																}
															/>
														)}
														{s.status === "canceling" && (
															<DropdownMenuItem
																onSelect={() =>
																	reactivateMutation.mutate(s.storeId)
																}
															>
																Annulla cancellazione
															</DropdownMenuItem>
														)}
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Storico fatture</CardTitle>
				</CardHeader>
				<CardContent>
					{invoicesLoading ? (
						<Spinner />
					) : !invoicesPage || invoicesPage.data.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							Nessuna fattura ancora.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Data</TableHead>
									<TableHead>Descrizione</TableHead>
									<TableHead>Importo</TableHead>
									<TableHead>Stato</TableHead>
									<TableHead>PDF</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{invoicesPage.data.map((inv) => (
									<TableRow key={inv.id}>
										<TableCell>{formatInvoiceDate(inv.createdAt)}</TableCell>
										<TableCell>{inv.description ?? "—"}</TableCell>
										<TableCell>{formatEuro(inv.amountPaidCents)}</TableCell>
										<TableCell>
											<Badge
												variant={
													inv.status === "paid" ? "default" : "destructive"
												}
											>
												{inv.status ?? "—"}
											</Badge>
										</TableCell>
										<TableCell>
											{inv.invoicePdfUrl && (
												<a
													href={inv.invoicePdfUrl}
													target="_blank"
													rel="noopener noreferrer"
													aria-label="Scarica fattura"
												>
													<Download className="h-4 w-4" />
												</a>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
