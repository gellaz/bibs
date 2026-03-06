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
	TagsIcon,
	UserIcon,
	UsersIcon,
	WalletIcon,
} from "lucide-react";
import LocaleSwitcher from "@/components/locale-switcher";
import ThemeToggle from "@/components/theme-toggle";
import BetterAuthHeader from "@/integrations/better-auth/header-user";

const navItems = [
	{ title: "Home", to: "/" as const, icon: HomeIcon },
	{ title: "Utenti", to: "/users" as const, icon: UsersIcon },
	{ title: "Venditori", to: "/sellers" as const, icon: ShieldCheckIcon },
	{ title: "Negozi", to: "/stores" as const, icon: StoreIcon },
	{ title: "Articoli", to: "/products" as const, icon: PackageIcon },
	{ title: "Categorie", to: "/categories" as const, icon: TagsIcon },
	{ title: "Incassi", to: "/collections" as const, icon: WalletIcon },
	{ title: "Pagamenti", to: "/payments" as const, icon: CreditCardIcon },
	{
		title: "Configurazioni",
		to: "/configurations" as const,
		icon: SettingsIcon,
	},
	{ title: "Profilo", to: "/profile" as const, icon: UserIcon },
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
								const isActive = pathname === item.to;
								return (
									<SidebarMenuItem key={item.title}>
										<SidebarMenuButton
											asChild
											tooltip={item.title}
											isActive={isActive}
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
						<LocaleSwitcher />
					</div>
					<BetterAuthHeader />
				</div>
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}
