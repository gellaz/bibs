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
import { ToggleGroup, ToggleGroupItem } from "@bibs/ui/components/toggle-group";
import { UserAvatar } from "@bibs/ui/components/user-avatar";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	LogOutIcon,
	MonitorIcon,
	MoonIcon,
	MoreHorizontalIcon,
	SunIcon,
	UserIcon,
	UsersIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SellerRoleBadge } from "@/components/seller-role-badge";
import { useIsOwner } from "@/hooks/use-is-owner";
import { authClient } from "@/lib/auth-client";
import { getLocale, locales, setLocale } from "@/paraglide/runtime";

type ThemeMode = "light" | "dark" | "auto";

const TRAY_CONTAINER = "rounded-lg bg-accent p-1 dark:bg-background";

const TRAY_ITEM =
	"rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground dark:hover:bg-accent/50 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs dark:aria-pressed:bg-accent data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs data-[state=on]:hover:bg-background data-[state=on]:hover:text-foreground dark:data-[state=on]:bg-accent dark:data-[state=on]:hover:bg-accent";

const LOCALE_FLAGS: Record<string, string> = {
	it: "🇮🇹",
	en: "🇬🇧",
};

const LOCALE_NAMES: Record<string, string> = {
	it: "Italiano",
	en: "English",
};

function getInitialMode(): ThemeMode {
	if (typeof window === "undefined") return "auto";
	const stored = window.localStorage.getItem("theme");
	if (stored === "light" || stored === "dark" || stored === "auto") {
		return stored;
	}
	return "auto";
}

function applyThemeMode(mode: ThemeMode) {
	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	const resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;
	document.documentElement.classList.remove("light", "dark");
	document.documentElement.classList.add(resolved);
	if (mode === "auto") {
		document.documentElement.removeAttribute("data-theme");
	} else {
		document.documentElement.setAttribute("data-theme", mode);
	}
	document.documentElement.style.colorScheme = resolved;
}

function useThemeMode() {
	const [mode, setMode] = useState<ThemeMode>("auto");

	useEffect(() => {
		const initialMode = getInitialMode();
		setMode(initialMode);
		applyThemeMode(initialMode);
	}, []);

	useEffect(() => {
		if (mode !== "auto") return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyThemeMode("auto");
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [mode]);

	function changeMode(next: ThemeMode) {
		setMode(next);
		applyThemeMode(next);
		window.localStorage.setItem("theme", next);
	}

	return [mode, changeMode] as const;
}

export function NavUser() {
	const { isMobile } = useSidebar();
	const { data: session } = authClient.useSession();
	const navigate = useNavigate();
	const isOwner = useIsOwner();
	const [themeMode, setThemeMode] = useThemeMode();
	const currentLocale = getLocale();

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
							<div className="flex items-center justify-between gap-3 px-2 py-1">
								<span className="text-xs font-medium text-muted-foreground">
									Aspetto
								</span>
								<ToggleGroup
									type="single"
									value={themeMode}
									onValueChange={(value) => {
										if (!value) return;
										setThemeMode(value as ThemeMode);
									}}
									size="sm"
									spacing={1}
									aria-label="Aspetto"
									className={TRAY_CONTAINER}
								>
									<ToggleGroupItem
										value="light"
										aria-label="Chiaro"
										className={TRAY_ITEM}
									>
										<SunIcon />
									</ToggleGroupItem>
									<ToggleGroupItem
										value="dark"
										aria-label="Scuro"
										className={TRAY_ITEM}
									>
										<MoonIcon />
									</ToggleGroupItem>
									<ToggleGroupItem
										value="auto"
										aria-label="Sistema"
										className={TRAY_ITEM}
									>
										<MonitorIcon />
									</ToggleGroupItem>
								</ToggleGroup>
							</div>
							<div className="flex items-center justify-between gap-3 px-2 py-1">
								<span className="text-xs font-medium text-muted-foreground">
									Lingua
								</span>
								<ToggleGroup
									type="single"
									value={currentLocale}
									onValueChange={(value) => {
										if (!value) return;
										setLocale(value as typeof currentLocale);
									}}
									size="sm"
									spacing={1}
									aria-label="Lingua"
									className={TRAY_CONTAINER}
								>
									{locales.map((locale) => {
										const name = LOCALE_NAMES[locale] ?? locale.toUpperCase();
										return (
											<ToggleGroupItem
												key={locale}
												value={locale}
												aria-label={name}
												title={name}
												className={`px-2 text-base leading-none ${TRAY_ITEM}`}
											>
												<span aria-hidden="true">
													{LOCALE_FLAGS[locale] ?? locale.toUpperCase()}
												</span>
											</ToggleGroupItem>
										);
									})}
								</ToggleGroup>
							</div>
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
