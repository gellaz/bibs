import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/")({
	component: Dashboard,
});

function Dashboard() {
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
					<CardDescription>Venditori attivi</CardDescription>
					<CardTitle className="text-2xl tabular-nums">0</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-xs text-muted-foreground">—</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Clienti registrati</CardDescription>
					<CardTitle className="text-2xl tabular-nums">0</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-xs text-muted-foreground">—</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Categorie</CardDescription>
					<CardTitle className="text-2xl tabular-nums">0</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-xs text-muted-foreground">—</p>
				</CardContent>
			</Card>
		</div>
	);
}
