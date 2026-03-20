import { Button } from "@bibs/ui/components/button";
import { TabNav, type TabNavItem } from "@bibs/ui/components/tab-nav";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ProductCategoriesPanel } from "@/features/product-categories/components/product-categories-panel";
import { StoreCategoriesPanel } from "@/features/store-categories/components/store-categories-panel";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/configurations")({
	component: ConfigurationsPage,
	validateSearch: (search: Record<string, unknown>) => ({
		tab: (search.tab as string) || "product-categories",
	}),
});

function ConfigurationsPage() {
	const { tab } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const [createOpen, setCreateOpen] = useState(false);

	const { data: countsData } = useQuery({
		queryKey: ["admin-configurations-counts"],
		queryFn: async () => {
			const response = await api().admin.configurations.counts.get();
			if (response.error) return null;
			return response.data?.data ?? null;
		},
	});

	const tabs: TabNavItem[] = [
		{
			value: "product-categories",
			label: "Categorie Prodotto",
			count: countsData?.productCategories ?? null,
		},
		{
			value: "store-categories",
			label: "Categorie Negozio",
			count: countsData?.storeCategories ?? null,
		},
	];

	const handleTabChange = (value: string) => {
		setCreateOpen(false);
		void navigate({ search: { tab: value } });
	};

	return (
		<div className="space-y-4">
			<PageHeader
				title="Configurazioni"
				description="Gestisci le configurazioni della piattaforma"
			/>

			<TabNav tabs={tabs} activeTab={tab} onTabChange={handleTabChange}>
				<Button onClick={() => setCreateOpen(true)}>
					<PlusIcon />
					<span>Nuova Categoria</span>
				</Button>
			</TabNav>

			{tab === "product-categories" && (
				<ProductCategoriesPanel
					createOpen={createOpen}
					onCreateOpenChange={setCreateOpen}
				/>
			)}
			{tab === "store-categories" && (
				<StoreCategoriesPanel
					createOpen={createOpen}
					onCreateOpenChange={setCreateOpen}
				/>
			)}
		</div>
	);
}
