import { Badge } from "@bibs/ui/components/badge";
import { Input } from "@bibs/ui/components/input";
import { Spinner } from "@bibs/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { DataPagination } from "@bibs/ui/custom/data-pagination";
import { PageSizeSelector } from "@bibs/ui/custom/page-size-selector";
import { unwrap } from "@bibs/ui/lib/api-client";
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { dataPaginationLabels } from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/billing/subscriptions")({
	component: SubscriptionsPage,
});

function formatDate(d: Date | string): string {
	return new Intl.DateTimeFormat(intlLocale(), {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date(d));
}

function SubscriptionsPage() {
	const [sellerEmail, setSellerEmail] = useState("");
	const [storeName, setStoreName] = useState("");
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(20);

	const { data, isLoading } = useQuery({
		queryKey: ["admin", "billing", "subs", sellerEmail, storeName, page, limit],
		queryFn: async () => {
			const r = await api().admin.billing.subscriptions.get({
				query: {
					page,
					limit,
					...(sellerEmail ? { sellerEmail } : {}),
					...(storeName ? { storeName } : {}),
				},
			});
			return unwrap(r, "Errore caricamento abbonamenti").data;
		},
		placeholderData: keepPreviousData,
	});

	const total = data?.pagination.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / limit));
	const offset = (page - 1) * limit;

	return (
		<div className="space-y-4">
			<div className="flex gap-2">
				<Input
					placeholder="Email seller"
					value={sellerEmail}
					onChange={(e) => {
						setSellerEmail(e.target.value);
						setPage(1);
					}}
				/>
				<Input
					placeholder="Nome negozio"
					value={storeName}
					onChange={(e) => {
						setStoreName(e.target.value);
						setPage(1);
					}}
				/>
			</div>
			{isLoading ? (
				<Spinner />
			) : (
				<>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Seller</TableHead>
								<TableHead>Negozio</TableHead>
								<TableHead>Stato</TableHead>
								<TableHead>Quota</TableHead>
								<TableHead>Rinnovo</TableHead>
								<TableHead>Creata</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data?.data.map((r) => (
								<TableRow key={r.id}>
									<TableCell>{r.sellerEmail}</TableCell>
									<TableCell>{r.storeName}</TableCell>
									<TableCell>
										<Badge>{r.status}</Badge>
									</TableCell>
									<TableCell>€{(r.feeAmountCents / 100).toFixed(2)}</TableCell>
									<TableCell>{formatDate(r.currentPeriodEnd)}</TableCell>
									<TableCell>{formatDate(r.createdAt)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					{total > 0 && (
						<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
							<p className="text-muted-foreground text-sm tabular-nums">
								{offset + 1}–{Math.min(page * limit, total)} di {total}{" "}
								{total === 1 ? "abbonamento" : "abbonamenti"}
							</p>
							<div className="flex items-center gap-4">
								<PageSizeSelector
									label={m.common_rows_per_page()}
									pageSize={limit}
									onPageSizeChange={(size) => {
										setLimit(size);
										setPage(1);
									}}
								/>
								<DataPagination
									labels={dataPaginationLabels()}
									page={page}
									totalPages={totalPages}
									onPageChange={setPage}
								/>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
