import { TabNav, type TabNavItem } from "@bibs/ui/components/tab-nav";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
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
			if (res.error) throw new Error("Errore caricamento conteggi");
			return res.data.data;
		},
		enabled: !!storeId,
	});

	const counts = data ?? { active: 0, disabled: 0, trashed: 0 };

	const tabs: TabNavItem[] = [
		{
			value: "active",
			label: m.products_tab_active(),
			count: counts.active,
			badgeColor: "emerald",
		},
		{
			value: "disabled",
			label: m.products_tab_disabled(),
			count: counts.disabled,
			badgeColor: "amber",
		},
		{
			value: "trashed",
			label: m.products_tab_trashed(),
			count: counts.trashed,
			badgeColor: "red",
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
