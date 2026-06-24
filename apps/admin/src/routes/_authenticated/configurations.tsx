import { CreateButton } from "@bibs/ui/components/create-button";
import { TabNav, type TabNavItem } from "@bibs/ui/components/tab-nav";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { CategoryCrudPanel } from "@/features/crud/category-crud-panel";
import { HolidaysPanel } from "@/features/holidays/components/holidays-panel";
import { ProductCategoriesPanel } from "@/features/product-categories/components/product-categories-panel";
import { productMacroCategoriesConfig } from "@/features/product-macro-categories/product-macro-categories.config";
import { storeCategoriesConfig } from "@/features/store-categories/store-categories.config";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/configurations")({
	component: ConfigurationsPage,
	validateSearch: (search: Record<string, unknown>) => ({
		tab: (search.tab as string) || "product-macro-categories",
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
			value: "product-macro-categories",
			label: "Macro Categorie Prodotto",
			count: countsData?.productMacroCategories ?? null,
		},
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
		{
			value: "holidays",
			label: "Festività",
			count: null,
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
				<CreateButton onClick={() => setCreateOpen(true)}>
					{tab === "holidays" ? "Nuova Festività" : "Nuova Categoria"}
				</CreateButton>
			</TabNav>

			{tab === "product-macro-categories" && (
				<CategoryCrudPanel
					config={productMacroCategoriesConfig}
					createOpen={createOpen}
					onCreateOpenChange={setCreateOpen}
				/>
			)}
			{tab === "product-categories" && (
				<ProductCategoriesPanel
					createOpen={createOpen}
					onCreateOpenChange={setCreateOpen}
				/>
			)}
			{tab === "store-categories" && (
				<CategoryCrudPanel
					config={storeCategoriesConfig}
					createOpen={createOpen}
					onCreateOpenChange={setCreateOpen}
				/>
			)}
			{tab === "holidays" && (
				<HolidaysPanel
					createOpen={createOpen}
					onCreateOpenChange={setCreateOpen}
				/>
			)}
		</div>
	);
}
