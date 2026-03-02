import { createFileRoute } from "@tanstack/react-router";
import { SettingsIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/configurations")({
	component: ConfigurationsPage,
});

function ConfigurationsPage() {
	return (
		<div className="space-y-4">
			<PageHeader
				title="Configurazioni"
				description="Gestisci le configurazioni della piattaforma"
			/>
			<div className="bg-card flex h-64 flex-col items-center justify-center gap-2 rounded-lg border">
				<SettingsIcon className="text-muted-foreground/40 size-8" />
				<p className="text-muted-foreground text-sm">Contenuto in arrivo</p>
			</div>
		</div>
	);
}
