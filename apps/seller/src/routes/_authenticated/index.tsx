import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";
import { useStores } from "@/hooks/use-stores";

export const Route = createFileRoute("/_authenticated/")({
	component: Dashboard,
});

function Dashboard() {
	const { data: stores } = useStores();
	const storeCount = stores?.length ?? 0;

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<Card>
				<CardHeader>
					<CardDescription>Ordini oggi</CardDescription>
					<CardTitle className="text-2xl tabular-nums">0</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-xs text-muted-foreground">Nessun ordine</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Negozi</CardDescription>
					<CardTitle className="text-2xl tabular-nums">{storeCount}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-xs text-muted-foreground">
						{storeCount === 0
							? "Nessun negozio"
							: storeCount === 1
								? "1 punto vendita"
								: `${storeCount} punti vendita`}
					</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Prodotti</CardDescription>
					<CardTitle className="text-2xl tabular-nums">0</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-xs text-muted-foreground">—</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Dipendenti</CardDescription>
					<CardTitle className="text-2xl tabular-nums">0</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-xs text-muted-foreground">—</p>
				</CardContent>
			</Card>
		</div>
	);
}
