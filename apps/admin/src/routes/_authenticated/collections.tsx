import { createFileRoute } from "@tanstack/react-router";
import { WalletIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/collections")({
	component: CollectionsPage,
});

function CollectionsPage() {
	return (
		<div className="space-y-4">
			<PageHeader
				title={m.common_revenue()}
				description={m.placeholder_revenue_description()}
			/>
			<div className="bg-card flex h-64 flex-col items-center justify-center gap-2 rounded-lg border">
				<WalletIcon className="text-muted-foreground/40 size-8" />
				<p className="text-muted-foreground text-sm">
					{m.common_coming_soon()}
				</p>
			</div>
		</div>
	);
}
