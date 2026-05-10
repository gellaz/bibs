import { BrandMark } from "@bibs/ui/components/brand-mark";
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

const navItems = [
	{ title: "Home", to: "/" as const, icon: HomeIcon },
	{ title: "Utenti", to: "/users" as const, icon: UsersIcon },
	{ title: "Venditori", to: "/sellers" as const, icon: ShieldCheckIcon },
	{ title: "Negozi", to: "/stores" as const, icon: StoreIcon },
	{ title: "Articoli", to: "/products" as const, icon: PackageIcon },
	{ title: "Incassi", to: "/collections" as const, icon: WalletIcon },
	{ title: "Pagamenti", to: "/payments" as const, icon: CreditCardIcon },
	{
		title: "Configurazioni",
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
				<NavUser />
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}
