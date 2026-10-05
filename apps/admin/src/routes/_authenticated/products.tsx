import { createFileRoute } from "@tanstack/react-router";
import { PackageIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/products")({
	component: ProductsPage,
});

function ProductsPage() {
	return (
		<div className="space-y-4">
			<PageHeader
				title={m.common_products()}
				description={m.placeholder_products_description()}
			/>
			<div className="bg-card flex h-64 flex-col items-center justify-center gap-2 rounded-lg border">
				<PackageIcon className="text-muted-foreground/40 size-8" />
				<p className="text-muted-foreground text-sm">
					{m.common_coming_soon()}
				</p>
			</div>
		</div>
	);
}
