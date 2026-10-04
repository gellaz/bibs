import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
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
import { ThemeToggle } from "@bibs/ui/custom/theme-toggle";
import { UserAvatar } from "@bibs/ui/custom/user-avatar";
import { displayName } from "@bibs/ui/lib/display-name";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { LocaleSelect } from "@/components/locale-select";
import { authClient } from "@/lib/auth-client";

export function NavUser() {
	const { isMobile } = useSidebar();
	const { data: session } = authClient.useSession();
	const navigate = useNavigate();

	if (!session?.user) {
		return null;
	}

	const user = session.user;
	const label = displayName(user);

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<UserAvatar name={label} image={user.image} />
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">{label}</span>
								{label !== user.email && (
									<span className="truncate text-xs">{user.email}</span>
								)}
							</div>
							<ChevronsUpDownIcon className="ml-auto size-4" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
						side={isMobile ? "bottom" : "right"}
						align="end"
						sideOffset={4}
					>
						<DropdownMenuLabel className="p-0 font-normal">
							<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
								<UserAvatar name={label} image={user.image} />
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">{label}</span>
									{label !== user.email && (
										<span className="truncate text-xs">{user.email}</span>
									)}
								</div>
							</div>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<ThemeToggle />
							<LocaleSelect />
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => {
								void authClient
									.signOut()
									.then(() => navigate({ to: "/login" }));
							}}
						>
							<LogOutIcon />
							Esci
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
