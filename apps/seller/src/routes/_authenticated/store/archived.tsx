import { Badge } from "@bibs/ui/components/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
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
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/store/archived")({
	component: ArchivedPage,
});

const REASON_LABEL: Record<string, string> = {
	seller_canceled: "Cancellato dal seller",
	payment_failed_auto: "Auto-cancellato (insolvenza)",
	admin_canceled: "Cancellato da admin",
};

function formatDate(d: Date | string): string {
	return new Intl.DateTimeFormat("it-IT", {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date(d));
}

function ArchivedPage() {
	const { data, isLoading } = useQuery({
		queryKey: ["seller", "stores", "archived"],
		queryFn: async () => {
			const r = await api().seller.stores.archived.get({
				query: { page: 1, limit: 50 },
			});
			if (r.error) throw new Error(r.error.value?.message);
			return r.data?.data;
		},
	});

	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">
					Negozi archiviati
				</h1>
				<p className="text-muted-foreground text-sm">
					Negozi cancellati. I dati storici sono conservati ma non modificabili.
				</p>
			</div>
			<Card>
				<CardHeader>
					<CardTitle>Archivio</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<Spinner />
					) : !data || data.data.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							Nessun negozio archiviato.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Nome</TableHead>
									<TableHead>Indirizzo</TableHead>
									<TableHead>Creato</TableHead>
									<TableHead>Archiviato</TableHead>
									<TableHead>Motivo</TableHead>
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
												{r.cancelReason
													? (REASON_LABEL[r.cancelReason] ?? r.cancelReason)
													: "—"}
											</Badge>
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
