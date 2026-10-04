import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
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
import { ThemeToggle } from "@bibs/ui/custom/theme-toggle";
import { UserAvatar } from "@bibs/ui/custom/user-avatar";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	LogOutIcon,
	MoreHorizontalIcon,
	UserIcon,
	UsersIcon,
} from "lucide-react";
import { LocaleSelect } from "@/components/locale-select";
import { SellerRoleBadge } from "@/components/seller-role-badge";
import { useIsOwner } from "@/hooks/use-is-owner";
import { authClient } from "@/lib/auth-client";

export function NavUser() {
	const { isMobile } = useSidebar();
	const { data: session } = authClient.useSession();
	const navigate = useNavigate();
	const isOwner = useIsOwner();

	if (!session?.user) return null;

	const user = session.user;
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<UserAvatar name={user.name} image={user.image} />
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">{user.name}</span>
								<span className="truncate text-xs text-muted-foreground">
									{user.email}
								</span>
							</div>
							<MoreHorizontalIcon
								aria-label="Apri menu utente"
								className="ml-auto size-4 text-muted-foreground"
							/>
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="min-w-64 rounded-lg"
						side={isMobile ? "bottom" : "right"}
						align="end"
						sideOffset={8}
					>
						<div className="flex items-center gap-3 px-2 py-2.5">
							<UserAvatar name={user.name} image={user.image} size="lg" />
							<div className="grid min-w-0 flex-1 leading-tight">
								<span className="truncate text-sm font-medium">
									{user.name}
								</span>
								<span className="truncate text-xs text-muted-foreground">
									{user.email}
								</span>
								<SellerRoleBadge
									userRole={user.role}
									className="mt-1.5 w-fit"
								/>
							</div>
						</div>

						<DropdownMenuSeparator />

						<DropdownMenuGroup>
							<DropdownMenuItem asChild>
								<Link to="/profile">
									<UserIcon />
									<span>Il mio profilo</span>
								</Link>
							</DropdownMenuItem>
							{isOwner && (
								<DropdownMenuItem asChild>
									<Link to="/team" search={{ page: 1, limit: 20 }}>
										<UsersIcon />
										<span>Team</span>
									</Link>
								</DropdownMenuItem>
							)}
						</DropdownMenuGroup>

						<DropdownMenuSeparator />

						<div className="flex flex-col gap-1 py-1">
							<ThemeToggle />
							<LocaleSelect />
						</div>

						<DropdownMenuSeparator />

						<DropdownMenuItem
							onClick={() => {
								void authClient
									.signOut()
									.then(() => navigate({ to: "/login" }));
							}}
						>
							<LogOutIcon />
							<span>Esci</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
