import { CreateButton } from "@bibs/ui/custom/create-button";
import { TabNav, type TabNavItem } from "@bibs/ui/custom/tab-nav";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { CategoryCrudPanel } from "@/features/crud/category-crud-panel";
import { HolidaysPanel } from "@/features/holidays/components/holidays-panel";
import { productCategoriesConfig } from "@/features/product-categories/product-categories.config";
import { productCharacteristicsConfig } from "@/features/product-characteristics/product-characteristics.config";
import { productMacroCategoriesConfig } from "@/features/product-macro-categories/product-macro-categories.config";
import { storeCategoriesConfig } from "@/features/store-categories/store-categories.config";
import { storeMacroCategoriesConfig } from "@/features/store-macro-categories/store-macro-categories.config";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

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
			label: m.configurations_tab_product_macro_categories(),
			count: countsData?.productMacroCategories ?? null,
		},
		{
			value: "product-categories",
			label: m.configurations_tab_product_categories(),
			count: countsData?.productCategories ?? null,
		},
		{
			value: "product-characteristics",
			label: m.configurations_tab_product_characteristics(),
			count: countsData?.productCharacteristics ?? null,
		},
		{
			value: "store-macro-categories",
			label: m.configurations_tab_store_macro_categories(),
			count: countsData?.storeMacroCategories ?? null,
		},
		{
			value: "store-categories",
			label: m.configurations_tab_store_categories(),
			count: countsData?.storeCategories ?? null,
		},
		{
			value: "holidays",
			label: m.configurations_tab_holidays(),
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
				title={m.configurations_title()}
				description={m.configurations_description()}
			/>

			<TabNav
				tabs={tabs}
				activeTab={tab}
				onTabChange={handleTabChange}
				label={m.configurations_title()}
			>
				<CreateButton onClick={() => setCreateOpen(true)}>
					{tab === "holidays"
						? m.configurations_new_holiday()
						: tab === "product-characteristics"
							? m.configurations_new_characteristic()
							: m.configurations_new_category()}
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
				<CategoryCrudPanel
					config={productCategoriesConfig}
					createOpen={createOpen}
					onCreateOpenChange={setCreateOpen}
				/>
			)}
			{tab === "product-characteristics" && (
				<CategoryCrudPanel
					config={productCharacteristicsConfig}
					createOpen={createOpen}
					onCreateOpenChange={setCreateOpen}
				/>
			)}
			{tab === "store-macro-categories" && (
				<CategoryCrudPanel
					config={storeMacroCategoriesConfig}
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
