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
import { BrandMark } from "@bibs/ui/custom/brand-mark";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	CreditCardIcon,
	HomeIcon,
	PackageIcon,
	SettingsIcon,
	ShieldCheckIcon,
	StoreIcon,
	UsersIcon,
	WalletIcon,
} from "lucide-react";
import { NavUser } from "@/components/nav-user";
import { m } from "@/paraglide/messages";

// Titoli come funzioni: vanno letti a ogni render, dopo un cambio di lingua.
const navItems = [
	{ title: m.shell_nav_home, to: "/" as const, icon: HomeIcon },
	{ title: m.common_users, to: "/users" as const, icon: UsersIcon },
	{ title: m.common_sellers, to: "/sellers" as const, icon: ShieldCheckIcon },
	{ title: m.common_stores, to: "/stores" as const, icon: StoreIcon },
	{ title: m.common_products, to: "/products" as const, icon: PackageIcon },
	{ title: m.common_revenue, to: "/collections" as const, icon: WalletIcon },
	{ title: m.billing_title, to: "/billing" as const, icon: CreditCardIcon },
	{
		title: m.configurations_title,
		to: "/configurations" as const,
		icon: SettingsIcon,
	},
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
								<BrandMark className="size-8" />
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="font-display truncate font-semibold">
										bibs
									</span>
									<span className="truncate text-xs text-muted-foreground">
										Admin
									</span>
								</div>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>{m.shell_nav_label()}</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{navItems.map((item) => {
								const isActive =
									item.to === "/"
										? pathname === "/"
										: pathname.startsWith(item.to);
								return (
									<SidebarMenuItem key={item.to}>
										<SidebarMenuButton
											asChild
											tooltip={item.title()}
											isActive={isActive}
											className="data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
										>
											<Link to={item.to}>
												<item.icon />
												<span>{item.title()}</span>
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
