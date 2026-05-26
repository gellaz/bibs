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
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/billing/subscriptions")({
	component: SubscriptionsPage,
});

function formatDate(d: Date | string): string {
	return new Intl.DateTimeFormat("it-IT", {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date(d));
}

function SubscriptionsPage() {
	const [sellerEmail, setSellerEmail] = useState("");
	const [storeName, setStoreName] = useState("");

	const { data, isLoading } = useQuery({
		queryKey: ["admin", "billing", "subs", sellerEmail, storeName],
		queryFn: async () => {
			const r = await api().admin.billing.subscriptions.get({
				query: {
					page: 1,
					limit: 50,
					...(sellerEmail ? { sellerEmail } : {}),
					...(storeName ? { storeName } : {}),
				},
			});
			if (r.error) throw new Error(r.error.value?.message);
			return r.data?.data;
		},
	});

	return (
		<div className="space-y-4">
			<div className="flex gap-2">
				<Input
					placeholder="Email seller"
					value={sellerEmail}
					onChange={(e) => setSellerEmail(e.target.value)}
				/>
				<Input
					placeholder="Nome negozio"
					value={storeName}
					onChange={(e) => setStoreName(e.target.value)}
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
					{data && (
						<p className="text-muted-foreground text-xs">
							{data.data.length} di {data.pagination.total} risultati
						</p>
					)}
				</>
			)}
		</div>
	);
}
