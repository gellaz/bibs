import { Badge } from "@bibs/ui/components/badge";
import { useStores } from "@/hooks/use-stores";

export function StoreChips({ storeIds }: { storeIds: string[] }) {
	const { data: stores } = useStores();
	const lookup = new Map((stores ?? []).map((s) => [s.id, s.name] as const));

	if (storeIds.length === 0) {
		return (
			<span className="text-xs text-muted-foreground italic">
				Nessun negozio
			</span>
		);
	}

	return (
		<div className="flex flex-wrap gap-1">
			{storeIds.map((id) => (
				<Badge key={id} variant="secondary" className="text-xs">
					{lookup.get(id) ?? "?"}
				</Badge>
			))}
		</div>
	);
}
