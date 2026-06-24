import { TabNav, type TabNavItem } from "@bibs/ui/components/tab-nav";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

export type ProductStatusFilter = "active" | "disabled" | "trashed";

interface Props {
	storeId: string;
	value: ProductStatusFilter;
	onChange: (value: ProductStatusFilter) => void;
}

export function ProductStatusTabs({ storeId, value, onChange }: Props) {
	const { data } = useQuery({
		queryKey: ["product-status-counts", storeId],
		queryFn: async () => {
			const res = await api().seller.products["status-counts"].get({
				query: { storeId },
			});
			return unwrap(res, "Errore caricamento conteggi").data;
		},
		enabled: !!storeId,
	});

	const counts = data ?? { active: 0, disabled: 0, trashed: 0 };

	const tabs: TabNavItem[] = [
		{
			value: "active",
			label: m.products_tab_active(),
			count: counts.active,
			badgeColor: "success",
		},
		{
			value: "disabled",
			label: m.products_tab_disabled(),
			count: counts.disabled,
			badgeColor: "warning",
		},
		{
			value: "trashed",
			label: m.products_tab_trashed(),
			count: counts.trashed,
			badgeColor: "destructive",
		},
	];

	return (
		<TabNav
			tabs={tabs}
			activeTab={value}
			onTabChange={(v) => onChange(v as ProductStatusFilter)}
		/>
	);
}
