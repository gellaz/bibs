import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { ThemeToggle } from "@bibs/ui/components/theme-toggle";
import { UserAvatar } from "@bibs/ui/components/user-avatar";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";

/**
 * Avatar dell'utente nella top bar: apre il menu account (profilo, logout).
 * Il trigger è un'area di tocco da 44px (linea guida mobile-first del customer);
 * l'avatar interno resta a 32px. Anello di focus saffron, accent del register
 * brand (mai cobalt, riservato a seller/admin).
 */
export function UserMenu() {
	const { data: session } = authClient.useSession();
	const navigate = useNavigate();
	const user = session?.user;

	if (!user) {
		return null;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label="Apri il menu account"
					className="flex size-11 items-center justify-center rounded-full outline-none transition-[background-color] hover:bg-muted focus-visible:ring-2 focus-visible:ring-saffron focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				>
					<UserAvatar name={user.name} image={user.image} />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" sideOffset={8} className="w-64">
				<DropdownMenuLabel className="flex flex-col gap-0.5">
					<span className="truncate font-medium text-foreground text-sm">
						{user.name}
					</span>
					<span className="truncate font-normal text-muted-foreground text-xs">
						{user.email}
					</span>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/profile">
						<UserRound />
						Il mio profilo
					</Link>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<ThemeToggle />
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onSelect={() => {
						void authClient.signOut().then(() => navigate({ to: "/login" }));
					}}
				>
					<LogOut />
					Esci
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
