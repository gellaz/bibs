import { createFileRoute } from "@tanstack/react-router";
import { PackageIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/products")({
	component: ProductsPage,
});

function ProductsPage() {
	return (
		<div className="space-y-4">
			<PageHeader
				title="Articoli"
				description="Gestisci gli articoli della piattaforma"
			/>
			<div className="bg-card flex h-64 flex-col items-center justify-center gap-2 rounded-lg border">
				<PackageIcon className="text-muted-foreground/40 size-8" />
				<p className="text-muted-foreground text-sm">Contenuto in arrivo</p>
			</div>
		</div>
	);
}
