import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { ChevronsUpDownIcon, StoreIcon } from "lucide-react";
import { useActiveStore } from "@/hooks/use-active-store";

export function StoreSwitcher() {
	const { activeStore, stores, isLoading, setActiveStoreId } = useActiveStore();

	if (isLoading || stores.length === 0) {
		return null;
	}

	// Single store: just show name, no dropdown
	if (stores.length === 1) {
		return (
			<div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
				<div className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground">
					<StoreIcon className="size-3" />
				</div>
				<span className="max-w-[140px] truncate text-sm font-medium">
					{stores[0].name}
				</span>
			</div>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label="Seleziona negozio"
					className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<div className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground">
						<StoreIcon className="size-3" />
					</div>
					<span className="max-w-[140px] truncate font-medium">
						{activeStore?.name ?? "Seleziona negozio"}
					</span>
					<ChevronsUpDownIcon className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuLabel>Negozio attivo</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup
					value={activeStore?.id ?? ""}
					onValueChange={setActiveStoreId}
				>
					{stores.map((store) => (
						<DropdownMenuRadioItem key={store.id} value={store.id}>
							<div className="flex flex-col">
								<span>{store.name}</span>
								<span className="text-xs text-muted-foreground">
									{store.addressLine1}, {store.city}
									{store.province ? ` (${store.province})` : ""}
								</span>
							</div>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
