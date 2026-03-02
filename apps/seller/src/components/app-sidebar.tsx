import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@bibs/ui/components/sidebar";
import { Link, useRouterState } from "@tanstack/react-router";
import { HomeIcon, PackageIcon, StoreIcon } from "lucide-react";
import ParaglideLocaleSwitcher from "@/components/locale-switcher";
import ThemeToggle from "@/components/theme-toggle";
import BetterAuthHeader from "@/integrations/better-auth/header-user";

const navItems = [
	{ title: "Home", to: "/" as const, icon: HomeIcon },
	{ title: "Negozi", to: "/stores" as const, icon: StoreIcon },
	{ title: "Prodotti", to: "/products" as const, icon: PackageIcon },
];

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild>
							<Link to="/">
								<div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg text-sm font-bold">
									B
								</div>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-semibold">Bibs</span>
									<span className="truncate text-xs text-muted-foreground">
										Seller
									</span>
								</div>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Navigazione</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
						{navItems.map((item) => {
							const isActive =
								item.to === "/"
									? pathname === "/"
									: pathname.startsWith(item.to);
							return (
								<SidebarMenuItem key={item.title}>
									<SidebarMenuButton
										asChild
										tooltip={item.title}
										isActive={isActive}
										className="data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
									>
										<Link to={item.to}>
											<item.icon />
											<span>{item.title}</span>
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
								);
							})}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			<SidebarFooter>
				<div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
					<div className="flex items-center gap-2">
						<ThemeToggle />
						<ParaglideLocaleSwitcher />
					</div>
					<BetterAuthHeader />
				</div>
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}
