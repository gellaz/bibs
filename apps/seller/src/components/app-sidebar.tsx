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
	HomeIcon,
	PackageIcon,
	StoreIcon,
	UserIcon,
	UsersIcon,
} from "lucide-react";
import { NavUser } from "@/components/nav-user";
import { StoreSwitcher } from "@/components/store-switcher";

const navItems = [
	{ title: "Home", to: "/" as const, icon: HomeIcon },
	{ title: "Negozi", to: "/stores" as const, icon: StoreIcon },
	{ title: "Prodotti", to: "/products" as const, icon: PackageIcon },
	{ title: "Team", to: "/team" as const, icon: UsersIcon },
	{ title: "Profilo", to: "/profile" as const, icon: UserIcon },
];

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

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
