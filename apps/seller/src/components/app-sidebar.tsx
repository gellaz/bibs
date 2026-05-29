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
import {
	ArchiveIcon,
	CreditCardIcon,
	HomeIcon,
	PackageIcon,
	SettingsIcon,
	TagIcon,
} from "lucide-react";
import { NavUser } from "@/components/nav-user";
import { StoreSwitcher } from "@/components/store-switcher";
import { useIsOwner } from "@/hooks/use-is-owner";

const navItems = [
	{
		title: "Home",
		to: "/" as const,
		icon: HomeIcon,
		match: (p: string) => p === "/",
	},
	{
		title: "Prodotti",
		to: "/products" as const,
		icon: PackageIcon,
		match: (p: string) => p.startsWith("/products"),
	},
	{
		title: "Promozioni",
		to: "/promotions" as const,
		icon: TagIcon,
		match: (p: string) => p.startsWith("/promotions"),
	},
	{
		title: "Impostazioni negozio",
		to: "/store" as const,
		icon: SettingsIcon,
		match: (p: string) => p === "/store" || p.startsWith("/store/edit"),
	},
	{
		title: "Archivio",
		to: "/store/archived" as const,
		icon: ArchiveIcon,
		match: (p: string) => p.startsWith("/store/archived"),
	},
	{
		title: "Billing",
		to: "/billing" as const,
		icon: CreditCardIcon,
		match: (p: string) => p.startsWith("/billing"),
		ownerOnly: true,
	},
];

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const isOwner = useIsOwner();
	// Owner-only destinations (billing) are hidden from employees, mirroring the
	// requireOwner guard the API enforces on those endpoints.
	const visibleItems = navItems.filter(
		(item) => isOwner || !("ownerOnly" in item),
	);

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<StoreSwitcher />
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Navigazione</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{visibleItems.map((item) => {
								const isActive = item.match(pathname);
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
				<NavUser />
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}
