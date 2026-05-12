import { Badge } from "@bibs/ui/components/badge";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@bibs/ui/components/popover";
import { useStores } from "@/hooks/use-stores";

const MAX_VISIBLE = 2;

export function StoreChips({ storeIds }: { storeIds: string[] }) {
	const { data: stores } = useStores();
	const lookup = new Map((stores ?? []).map((s) => [s.id, s.name] as const));

	if (storeIds.length === 0) {
		return (
			<span className="text-muted-foreground text-xs italic">
				Nessun negozio
			</span>
		);
	}

	const visible = storeIds.slice(0, MAX_VISIBLE);
	const overflow = storeIds.slice(MAX_VISIBLE);

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{visible.map((id) => (
				<Badge
					key={id}
					variant="outline"
					className="max-w-[10rem] truncate text-xs font-normal"
				>
					<span className="truncate">{lookup.get(id) ?? "?"}</span>
				</Badge>
			))}
			{overflow.length > 0 && (
				<Popover>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="cursor-pointer rounded-4xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
						>
							<Badge
								variant="outline"
								className="text-xs font-normal hover:bg-accent"
							>
								+{overflow.length}
							</Badge>
						</button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-auto max-w-xs p-2">
						<ul className="flex flex-col gap-0.5 text-sm">
							{overflow.map((id) => (
								<li key={id} className="truncate px-2 py-1">
									{lookup.get(id) ?? "?"}
								</li>
							))}
						</ul>
					</PopoverContent>
				</Popover>
			)}
		</div>
	);
}
