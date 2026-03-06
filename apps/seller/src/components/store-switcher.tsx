import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@bibs/ui/components/sidebar";
import { ChevronsUpDownIcon, StoreIcon } from "lucide-react";
import { useActiveStore } from "@/hooks/use-active-store";

export function StoreSwitcher() {
	const { isMobile } = useSidebar();
	const { activeStore, stores, isLoading, setActiveStoreId } = useActiveStore();

	if (isLoading || stores.length === 0) {
		return null;
	}

	// Single store: just show name, no dropdown
	if (stores.length === 1) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton size="lg">
						<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
							<StoreIcon className="size-4" />
						</div>
						<div className="grid flex-1 text-left text-sm leading-tight">
							<span className="truncate font-medium">{stores[0].name}</span>
							<span className="truncate text-xs">
								{stores[0].city}
								{stores[0].province ? ` (${stores[0].province})` : ""}
							</span>
						</div>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		);
	}

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
								<StoreIcon className="size-4" />
							</div>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">
									{activeStore?.name ?? "Seleziona negozio"}
								</span>
								<span className="truncate text-xs">
									{activeStore?.city}
									{activeStore?.province ? ` (${activeStore.province})` : ""}
								</span>
							</div>
							<ChevronsUpDownIcon className="ml-auto" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
						align="start"
						side={isMobile ? "bottom" : "right"}
						sideOffset={4}
					>
						<DropdownMenuLabel className="text-xs text-muted-foreground">
							Negozi
						</DropdownMenuLabel>
						{stores.map((store) => (
							<DropdownMenuItem
								key={store.id}
								onClick={() => setActiveStoreId(store.id)}
								className="gap-2 p-2"
							>
								<div className="flex size-6 items-center justify-center rounded-md border">
									<StoreIcon className="size-3.5 shrink-0" />
								</div>
								<div className="flex flex-col">
									<span>{store.name}</span>
									<span className="text-xs text-muted-foreground">
										{store.addressLine1}, {store.city}
										{store.province ? ` (${store.province})` : ""}
									</span>
								</div>
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
