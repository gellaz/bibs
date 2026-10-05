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
	BoxesIcon,
	CreditCardIcon,
	HomeIcon,
	ReceiptIcon,
	ScanLineIcon,
	SettingsIcon,
	TagIcon,
} from "lucide-react";
import { NavUser } from "@/components/nav-user";
import { StoreSwitcher } from "@/components/store-switcher";
import { useIsOwner } from "@/hooks/use-is-owner";
import { m } from "@/paraglide/messages";

const navItems = [
	{
		title: m.shell_nav_home,
		to: "/" as const,
		icon: HomeIcon,
		match: (p: string) => p === "/",
	},
	{
		// BoxesIcon = la sezione catalogo (tanti prodotti); PackageIcon resta
		// al singolo collo: placeholder immagine riga e azione "Adegua stock".
		title: m.shell_nav_products,
		to: "/products" as const,
		icon: BoxesIcon,
		match: (p: string) => p.startsWith("/products"),
	},
	{
		title: m.shell_nav_orders,
		to: "/orders" as const,
		icon: ReceiptIcon,
		match: (p: string) => p.startsWith("/orders"),
	},
	{
		title: m.shell_nav_pickup,
		to: "/pickup" as const,
		icon: ScanLineIcon,
		match: (p: string) => p.startsWith("/pickup"),
	},
	{
		title: m.shell_nav_promotions,
		to: "/promotions" as const,
		icon: TagIcon,
		match: (p: string) => p.startsWith("/promotions"),
		ownerOnly: true,
	},
	{
		title: m.shell_nav_store_settings,
		to: "/store" as const,
		icon: SettingsIcon,
		match: (p: string) => p === "/store" || p.startsWith("/store/edit"),
	},
	{
		title: m.shell_nav_archive,
		to: "/store/archived" as const,
		icon: ArchiveIcon,
		match: (p: string) => p.startsWith("/store/archived"),
		ownerOnly: true,
	},
	{
		title: m.shell_nav_billing,
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
					<SidebarGroupLabel>{m.shell_nav_label()}</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{visibleItems.map((item) => {
								const isActive = item.match(pathname);
								const title = item.title();
								return (
									<SidebarMenuItem key={item.to}>
										<SidebarMenuButton
											asChild
											tooltip={title}
											isActive={isActive}
											className="data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
										>
											<Link to={item.to}>
												<item.icon />
												<span>{title}</span>
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

			<SidebarRail label={m.shell_sidebar_toggle()} />
		</Sidebar>
	);
}
