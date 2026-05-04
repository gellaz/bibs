import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@bibs/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import {
	CheckIcon,
	ChevronsUpDownIcon,
	InfoIcon,
	PlusIcon,
	SettingsIcon,
	StoreIcon,
} from "lucide-react";
import { useActiveStore } from "@/hooks/use-active-store";
import { useIsOwner } from "@/hooks/use-is-owner";

export function StoreSwitcher() {
	const { isMobile } = useSidebar();
	const { activeStore, stores, isLoading, setActiveStoreId } = useActiveStore();
	const isOwner = useIsOwner();

	if (isLoading || stores.length === 0) {
		return null;
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
						{stores.map((store) => {
							const isActive = store.id === activeStore?.id;
							return (
								<DropdownMenuItem
									key={store.id}
									onClick={() => setActiveStoreId(store.id)}
									className="gap-2 p-2"
								>
									<div className="flex size-6 items-center justify-center rounded-md border">
										<StoreIcon className="size-3.5 shrink-0" />
									</div>
									<div className="flex flex-1 flex-col">
										<span>{store.name}</span>
										<span className="text-xs text-muted-foreground">
											{store.city}
											{store.province ? ` (${store.province})` : ""}
										</span>
									</div>
									{isActive && <CheckIcon className="size-4" />}
								</DropdownMenuItem>
							);
						})}
						<DropdownMenuSeparator />
						<DropdownMenuItem asChild>
							<Link to="/store">
								{isOwner ? <SettingsIcon /> : <InfoIcon />}
								<span>
									{isOwner
										? "Modifica negozio attivo"
										: "Informazioni negozio attivo"}
								</span>
							</Link>
						</DropdownMenuItem>
						{isOwner && (
							<DropdownMenuItem asChild>
								<Link to="/store/new">
									<PlusIcon />
									<span>Aggiungi negozio</span>
								</Link>
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
