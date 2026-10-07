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
import { formatPriceEur } from "@bibs/ui/custom/price";
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download, MoreVerticalIcon } from "lucide-react";
import { useEffect } from "react";
import { SectionHeader } from "@/components/section-header";
import { CancelStoreDialog } from "@/features/billing/components/cancel-store-dialog";
import { invoiceStatusLabel } from "@/features/billing/invoice-status";
import { useIsOwner } from "@/hooks/use-is-owner";
import { api, unwrap } from "@/lib/api";
import { richMessage } from "@/lib/rich-message";
import { m } from "@/paraglide/messages";

type ReactivationOutcome = "success" | "canceled";

export const Route = createFileRoute("/_authenticated/billing")({
	component: BillingPage,
	// Ritorno dalla Checkout di riattivazione (success_url / cancel_url).
	validateSearch: (
		search: Record<string, unknown>,
	): { reactivation?: ReactivationOutcome } =>
		search.reactivation === "success" || search.reactivation === "canceled"
			? { reactivation: search.reactivation }
			: {},
});

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

// Funzione e non costante: le etichette vanno lette a ogni render, dopo un
// cambio di lingua.
function statusBadge(
	status: string,
): { label: string; variant: BadgeVariant } | undefined {
	switch (status) {
		case "active":
			return { label: m.billing_status_active(), variant: "default" };
		case "past_due":
			return { label: m.billing_status_past_due(), variant: "destructive" };
		case "canceling":
			return { label: m.billing_status_canceling(), variant: "outline" };
		case "suspended":
			return { label: m.billing_status_suspended(), variant: "destructive" };
		default:
			return undefined;
	}
}

function formatEuro(cents: number): string {
	return formatPriceEur(cents / 100);
}

const DATE_FMT: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "long",
	year: "numeric",
};

const DATE_SHORT_FMT: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "short",
	year: "numeric",
};

function formatDate(d: Date | string, short = false): string {
	return short
		? new Intl.DateTimeFormat(intlLocale(), DATE_SHORT_FMT).format(new Date(d))
		: new Intl.DateTimeFormat(intlLocale(), DATE_FMT).format(new Date(d));
}

const INVOICE_DATE_FMT: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "short",
	year: "numeric",
};

function formatInvoiceDate(d: Date | string): string {
	return new Intl.DateTimeFormat(intlLocale(), INVOICE_DATE_FMT).format(
		new Date(d),
	);
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

	const { reactivation } = Route.useSearch();
	useEffect(() => {
		if (!reactivation) return;
		if (reactivation === "success") {
			// The webhook may land a moment after the redirect: refresh what
			// depends on it instead of trusting the cached lists.
			void queryClient.invalidateQueries({ queryKey: ["seller", "billing"] });
			void queryClient.invalidateQueries({ queryKey: ["seller", "stores"] });
			toast.success(m.billing_reactivation_success());
		} else {
			toast.info(m.billing_reactivation_canceled());
		}
		void navigate({ to: "/billing", search: {}, replace: true });
	}, [reactivation, queryClient, navigate]);

	const { data: summary, isLoading: summaryLoading } = useQuery({
		queryKey: ["seller", "billing", "summary"],
		enabled: isOwner,
		queryFn: async () => {
			const r = await api().seller.billing.summary.get();
			return unwrap(r, m.common_error()).data;
		},
	});

	const { data: subs, isLoading: subsLoading } = useQuery({
		queryKey: ["seller", "billing", "subscriptions"],
		enabled: isOwner,
		queryFn: async () => {
			const r = await api().seller.billing.subscriptions.get();
			return unwrap(r, m.common_error()).data ?? [];
		},
	});

	const { data: invoicesPage, isLoading: invoicesLoading } = useQuery({
		queryKey: ["seller", "billing", "invoices"],
		enabled: isOwner,
		queryFn: async () => {
			const r = await api().seller.billing.invoices.get({
				query: { limit: 25 },
			});
			return unwrap(r, m.common_error()).data;
		},
	});

	const portalMutation = useMutation({
		mutationFn: async () => {
			const r = await api().seller.billing.portal.post();
			return unwrap(r, m.common_error()).data;
		},
		onSuccess: (data) => {
			if (data?.url) window.location.href = data.url;
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const reactivateMutation = useMutation({
		mutationFn: async (storeId: string) => {
			const r = await api().seller.stores({ storeId }).reactivate.post();
			return unwrap(r, m.common_error()).data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["seller", "billing"] });
			toast.success(m.billing_cancel_undone());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className="space-y-6">
			<SectionHeader
				title={m.billing_title()}
				subtitle={m.billing_subtitle()}
			/>

			<Card>
				<CardHeader>
					<CardTitle>{m.billing_summary_title()}</CardTitle>
					<CardDescription>{m.billing_summary_description()}</CardDescription>
				</CardHeader>
				<CardContent>
					{summaryLoading || !summary ? (
						<Spinner />
					) : summary.billableStoresCount === 0 ? (
						<p className="text-muted-foreground text-sm">
							{m.billing_summary_empty()}
						</p>
					) : (
						<div className="flex flex-col gap-4">
							<p className="text-base">
								{richMessage(
									(summary.billableStoresCount === 1
										? m.billing_summary_paying_one
										: m.billing_summary_paying)({
										amount: "{amount}",
										count: "{count}",
									}),
									{
										amount: (
											<strong>
												{m.billing_per_month({
													amount: formatEuro(summary.totalMonthlyCents),
												})}
											</strong>
										),
										count: <strong>{summary.billableStoresCount}</strong>,
									},
								)}
							</p>
							{summary.nextRenewal && (
								<p className="text-muted-foreground text-sm">
									{richMessage(
										m.billing_next_renewal({
											date: "{date}",
											store: "{store}",
											amount: "{amount}",
										}),
										{
											date: (
												<strong>{formatDate(summary.nextRenewal.date)}</strong>
											),
											store: <strong>{summary.nextRenewal.storeName}</strong>,
											amount: formatEuro(summary.nextRenewal.amountCents),
										},
									)}
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
										m.billing_manage_on_stripe()
									)}
								</Button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{m.billing_subscriptions_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{subsLoading ? (
						<Spinner />
					) : !subs || subs.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{m.billing_subscriptions_empty()}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{m.billing_col_store()}</TableHead>
									<TableHead>{m.common_status()}</TableHead>
									<TableHead>{m.billing_col_fee()}</TableHead>
									<TableHead>{m.billing_col_next_renewal()}</TableHead>
									<TableHead className="w-10" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{subs.map((s) => {
									const badge = statusBadge(s.status) ?? {
										label: s.status,
										variant: "outline" as const,
									};
									const periodLabel =
										s.status === "suspended"
											? m.billing_period_expired({
													date: formatDate(s.currentPeriodEnd, true),
												})
											: s.status === "canceling" || s.cancelAtPeriodEnd
												? m.billing_period_ending({
														date: formatDate(s.currentPeriodEnd, true),
													})
												: formatDate(s.currentPeriodEnd, true);
									return (
										<TableRow key={s.storeId}>
											<TableCell>{s.storeName}</TableCell>
											<TableCell>
												<Badge variant={badge.variant}>{badge.label}</Badge>
											</TableCell>
											<TableCell>
												{m.billing_per_month({
													amount: formatEuro(s.feeAmountCents),
												})}
											</TableCell>
											<TableCell>{periodLabel}</TableCell>
											<TableCell>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															variant="ghost"
															size="icon"
															aria-label={m.common_actions()}
														>
															<MoreVerticalIcon className="h-4 w-4" />
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end">
														<DropdownMenuItem
															onSelect={() => portalMutation.mutate()}
														>
															{m.billing_manage_payment()}
														</DropdownMenuItem>
														{(((s.status === "active" ||
															s.status === "past_due") &&
															!s.cancelAtPeriodEnd) ||
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
																		{m.billing_cancel()}
																	</DropdownMenuItem>
																}
															/>
														)}
														{(s.status === "canceling" ||
															s.cancelAtPeriodEnd) &&
															s.status !== "suspended" && (
																<DropdownMenuItem
																	onSelect={() =>
																		reactivateMutation.mutate(s.storeId)
																	}
																>
																	{m.billing_undo_cancel()}
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
					<CardTitle>{m.billing_invoices_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{invoicesLoading ? (
						<Spinner />
					) : !invoicesPage || invoicesPage.data.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{m.billing_invoices_empty()}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{m.common_date()}</TableHead>
									<TableHead>{m.billing_col_description()}</TableHead>
									<TableHead>{m.billing_col_amount()}</TableHead>
									<TableHead>{m.common_status()}</TableHead>
									<TableHead>{m.billing_col_pdf()}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{invoicesPage.data.map((inv) => (
									<TableRow key={inv.id}>
										<TableCell>{formatInvoiceDate(inv.createdAt)}</TableCell>
										<TableCell>{inv.description ?? "—"}</TableCell>
										<TableCell>{formatEuro(inv.totalCents)}</TableCell>
										<TableCell>
											<Badge
												variant={
													inv.status === "paid" ? "default" : "destructive"
												}
											>
												{invoiceStatusLabel(inv.status)}
											</Badge>
										</TableCell>
										<TableCell>
											{inv.invoicePdfUrl && (
												<a
													href={inv.invoicePdfUrl}
													target="_blank"
													rel="noopener noreferrer"
													aria-label={m.billing_invoice_download()}
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
