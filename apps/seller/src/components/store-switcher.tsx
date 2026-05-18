import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
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
import { ChevronsUpDownIcon, PlusIcon, StoreIcon } from "lucide-react";
import { useActiveStore } from "@/hooks/use-active-store";
import { useIsOwner } from "@/hooks/use-is-owner";

export function StoreSwitcher() {
	const { isMobile } = useSidebar();
	const { activeStore, stores, isLoading, setActiveStoreId } = useActiveStore();
	const isOwner = useIsOwner();

	if (isLoading || stores.length === 0) {
		return null;
	}

	const otherStores = stores.filter((s) => s.id !== activeStore?.id);

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
						className="w-(--radix-dropdown-menu-trigger-width) min-w-64 overflow-hidden rounded-lg p-0"
						align="start"
						side={isMobile ? "bottom" : "right"}
						sideOffset={4}
					>
						{activeStore && (
							<div className="border-b px-3 py-3">
								<div className="truncate text-sm font-medium leading-snug">
									{activeStore.name}
								</div>
								<div className="mt-0.5 truncate text-xs text-muted-foreground">
									{activeStore.city}
									{activeStore.province ? ` (${activeStore.province})` : ""}
								</div>
							</div>
						)}

						{otherStores.length > 0 && (
							<div className="py-1">
								<div className="px-3 py-1.5 text-xs text-muted-foreground">
									Cambia negozio
								</div>
								{otherStores.map((store) => (
									<DropdownMenuItem
										key={store.id}
										onClick={() => setActiveStoreId(store.id)}
										className="mx-1 gap-2 rounded-md px-2 py-2"
									>
										<div className="flex size-6 items-center justify-center rounded-md border">
											<StoreIcon className="size-3.5 shrink-0" />
										</div>
										<div className="flex min-w-0 flex-1 flex-col">
											<span className="truncate">{store.name}</span>
											<span className="truncate text-xs text-muted-foreground">
												{store.city}
												{store.province ? ` (${store.province})` : ""}
											</span>
										</div>
									</DropdownMenuItem>
								))}
							</div>
						)}

						{isOwner && (
							<>
								{otherStores.length > 0 && (
									<DropdownMenuSeparator className="my-0" />
								)}
								<div className="py-1">
									<DropdownMenuItem
										asChild
										className="mx-1 gap-2 rounded-md px-2 py-2"
									>
										<Link to="/store/new">
											<PlusIcon className="size-4" />
											<span>Aggiungi negozio</span>
										</Link>
									</DropdownMenuItem>
								</div>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
