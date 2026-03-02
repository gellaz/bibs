import { createFileRoute } from "@tanstack/react-router";
import { SettingsIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/configurations")({
	component: ConfigurationsPage,
});

function ConfigurationsPage() {
	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-2xl font-bold">Configurazioni</h1>
				<p className="text-muted-foreground text-sm">
					Gestisci le configurazioni della piattaforma
				</p>
			</div>
			<div className="bg-card flex h-64 flex-col items-center justify-center gap-2 rounded-lg border">
				<SettingsIcon className="text-muted-foreground/40 size-8" />
				<p className="text-muted-foreground text-sm">Contenuto in arrivo</p>
			</div>
		</div>
	);
}
