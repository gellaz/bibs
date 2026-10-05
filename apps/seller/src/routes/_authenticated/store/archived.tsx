import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
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
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useIsOwner } from "@/hooks/use-is-owner";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/store/archived")({
	component: ArchivedPage,
});

// Funzione e non costante: le etichette vanno lette a ogni render, dopo un
// cambio di lingua.
function reasonLabel(reason: string): string {
	switch (reason) {
		case "seller_canceled":
			return m.store_archived_reason_seller();
		case "payment_failed_auto":
			return m.store_archived_reason_payment();
		case "admin_canceled":
			return m.store_archived_reason_admin();
		default:
			return reason;
	}
}

function formatDate(d: Date | string): string {
	return new Intl.DateTimeFormat(intlLocale(), {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date(d));
}

function ArchivedPage() {
	const navigate = useNavigate();
	const isOwner = useIsOwner();

	// The archive is owner-only (the API enforces requireOwner). Employees who
	// deep-link here are redirected home; the query stays disabled so it never
	// fires a request that would 403 and render a false "no archived stores".
	useEffect(() => {
		if (!isOwner) void navigate({ to: "/" });
	}, [isOwner, navigate]);

	const { data, isLoading } = useQuery({
		queryKey: ["seller", "stores", "archived"],
		queryFn: async () => {
			const r = await api().seller.stores.archived.get({
				query: { page: 1, limit: 50 },
			});
			return unwrap(r, m.common_error()).data;
		},
		enabled: isOwner,
	});

	// Nuovo abbonamento via Stripe Checkout: il negozio torna attivo quando il
	// webhook conferma il pagamento; success/cancel riportano su /billing.
	const reactivateMutation = useMutation({
		mutationFn: async (storeId: string) => {
			const r = await api()
				.seller.stores({ storeId })
				["reactivation-checkout"].post();
			return unwrap(r, m.common_error()).data;
		},
		onSuccess: (data) => {
			if (data?.checkoutUrl) window.location.href = data.checkoutUrl;
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">
					{m.store_archived_title()}
				</h1>
				<p className="text-muted-foreground text-sm">
					{m.store_archived_description()}
				</p>
			</div>
			<Card>
				<CardHeader>
					<CardTitle>{m.store_archived_card_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<Spinner />
					) : !data || data.data.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{m.store_archived_empty()}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{m.common_name()}</TableHead>
									<TableHead>{m.store_address()}</TableHead>
									<TableHead>{m.store_archived_created()}</TableHead>
									<TableHead>{m.store_archived_archived()}</TableHead>
									<TableHead>{m.store_archived_reason()}</TableHead>
									<TableHead className="w-28" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.data.map((r) => (
									<TableRow key={r.id}>
										<TableCell>{r.name}</TableCell>
										<TableCell>
											{r.addressLine1}, {r.municipality.name}
										</TableCell>
										<TableCell>{formatDate(r.createdAt)}</TableCell>
										<TableCell>
											{r.deletedAt ? formatDate(r.deletedAt) : "—"}
										</TableCell>
										<TableCell>
											<Badge variant="outline">
												{r.cancelReason ? reasonLabel(r.cancelReason) : "—"}
											</Badge>
										</TableCell>
										<TableCell className="text-right">
											{r.subscriptionStatus === "canceled" && (
												<Button
													size="sm"
													variant="outline"
													onClick={() => reactivateMutation.mutate(r.id)}
													disabled={reactivateMutation.isPending}
												>
													{reactivateMutation.isPending &&
													reactivateMutation.variables === r.id ? (
														<Spinner />
													) : (
														m.store_archived_reactivate()
													)}
												</Button>
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
