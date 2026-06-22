"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "~/components/toggle-group";
import { cn } from "~/lib/utils";

export type ThemeMode = "light" | "dark" | "auto";

/**
 * Stile del vassoio segmentato condiviso dal toggle del tema e da controlli
 * fratelli (es. lo switch lingua nella seller). Esportato così i consumer non
 * riscrivono le stesse classi. Token theme-aware → leggibile in chiaro e scuro.
 */
export const segmentedTrayClassName =
	"rounded-lg bg-accent p-1 dark:bg-background";
export const segmentedTrayItemClassName =
	"rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground dark:hover:bg-accent/50 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs dark:aria-pressed:bg-accent data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs data-[state=on]:hover:bg-background data-[state=on]:hover:text-foreground dark:data-[state=on]:bg-accent dark:data-[state=on]:hover:bg-accent";

function getInitialMode(): ThemeMode {
	if (typeof window === "undefined") return "auto";
	const stored = window.localStorage.getItem("theme");
	if (stored === "light" || stored === "dark" || stored === "auto") {
		return stored;
	}
	return "auto";
}

/**
 * Specchio runtime del THEME_INIT_SCRIPT presente nei `__root.tsx` delle app:
 * stessa chiave localStorage ("theme") e stesse classi/attributi, così init e
 * cambio a runtime restano coerenti (niente flash al reload).
 */
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

/** Stato del tema sincronizzato con localStorage + classi su `<html>`. */
export function useThemeMode() {
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

interface ThemeToggleProps {
	/** Etichetta della riga (default "Aspetto"). */
	label?: string;
	className?: string;
}

/**
 * Riga "Aspetto" con vassoio Chiaro / Scuro / Sistema. Pensata per vivere
 * dentro un menu (dropdown account): è un `<div>`, non un menu item, così
 * interagire col toggle non chiude il menu.
 */
export function ThemeToggle({
	label = "Aspetto",
	className,
}: ThemeToggleProps) {
	const [themeMode, setThemeMode] = useThemeMode();

	return (
		<div
			className={cn(
				"flex items-center justify-between gap-3 px-2 py-1",
				className,
			)}
		>
			<span className="font-medium text-muted-foreground text-xs">{label}</span>
			<ToggleGroup
				type="single"
				value={themeMode}
				onValueChange={(value) => {
					if (!value) return;
					setThemeMode(value as ThemeMode);
				}}
				size="sm"
				spacing={1}
				aria-label={label}
				className={segmentedTrayClassName}
			>
				<ToggleGroupItem
					value="light"
					aria-label="Chiaro"
					className={segmentedTrayItemClassName}
				>
					<SunIcon />
				</ToggleGroupItem>
				<ToggleGroupItem
					value="dark"
					aria-label="Scuro"
					className={segmentedTrayItemClassName}
				>
					<MoonIcon />
				</ToggleGroupItem>
				<ToggleGroupItem
					value="auto"
					aria-label="Sistema"
					className={segmentedTrayItemClassName}
				>
					<MonitorIcon />
				</ToggleGroupItem>
			</ToggleGroup>
		</div>
	);
}
