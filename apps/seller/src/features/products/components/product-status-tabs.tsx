import { Tabs, TabsList, TabsTrigger } from "@bibs/ui/components/tabs";
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

	return (
		<Tabs
			value={value}
			onValueChange={(v) => onChange(v as ProductStatusFilter)}
		>
			<TabsList>
				<TabsTrigger value="active">
					{m.products_tab_active()}{" "}
					<span className="ml-1 text-muted-foreground">
						{m.products_tab_count({ count: counts.active })}
					</span>
				</TabsTrigger>
				<TabsTrigger value="disabled">
					{m.products_tab_disabled()}{" "}
					<span className="ml-1 text-muted-foreground">
						{m.products_tab_count({ count: counts.disabled })}
					</span>
				</TabsTrigger>
				<TabsTrigger value="trashed">
					{m.products_tab_trashed()}{" "}
					<span className="ml-1 text-muted-foreground">
						{m.products_tab_count({ count: counts.trashed })}
					</span>
				</TabsTrigger>
			</TabsList>
		</Tabs>
	);
}
