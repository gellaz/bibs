import { createFileRoute } from "@tanstack/react-router";
import { StoreIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/stores")({
	component: StoresPage,
});

function StoresPage() {
	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-2xl font-bold">Negozi</h1>
				<p className="text-muted-foreground text-sm">
					Gestisci i negozi della piattaforma
				</p>
			</div>
			<div className="bg-card flex h-64 flex-col items-center justify-center gap-2 rounded-lg border">
				<StoreIcon className="text-muted-foreground/40 size-8" />
				<p className="text-muted-foreground text-sm">Contenuto in arrivo</p>
			</div>
		</div>
	);
}
