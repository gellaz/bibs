"use client";

import { useEffect, useRef, useState } from "react";
import type { StatusTone } from "~/custom/status-badge";
import { cn } from "~/lib/utils";

// Stessi toni dello StatusBadge (DESIGN.md §5): il contatore di una tab ha il
// colore dello stato che conta.
const BADGE_COLORS: Record<"default" | StatusTone, string> = {
	default:
		"bg-foreground/8 text-foreground/60 ring-1 ring-inset ring-foreground/10",
	action: "bg-action/12 text-action ring-1 ring-inset ring-action/40",
	waiting: "bg-waiting/12 text-waiting ring-1 ring-inset ring-waiting/40",
	success: "bg-success/12 text-success ring-1 ring-inset ring-success/40",
	closed: "text-muted-foreground ring-1 ring-inset ring-border",
	destructive:
		"bg-destructive/12 text-destructive ring-1 ring-inset ring-destructive/40",
};

export interface TabNavItem {
	value: string;
	label: string;
	count?: number | null;
	badgeColor?: "default" | StatusTone;
}

interface TabNavProps {
	tabs: TabNavItem[];
	activeTab: string;
	onTabChange: (value: string) => void;
	/** Nome accessibile del tablist (es. «Stato dei prodotti»). */
	label?: string;
	/** Id dell'elemento che le schede filtrano, per `aria-controls`. */
	panelId?: string;
	children?: React.ReactNode;
}

/** Indice della scheda raggiunta da un tasto, o null se il tasto non naviga. */
function targetIndex(key: string, current: number, count: number) {
	switch (key) {
		case "ArrowRight":
			return (current + 1) % count;
		case "ArrowLeft":
			return (current - 1 + count) % count;
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}

export function TabNav({
	tabs,
	activeTab,
	onTabChange,
	label,
	panelId,
	children,
}: TabNavProps) {
	const tabsRef = useRef<HTMLDivElement>(null);
	const [indicator, setIndicator] = useState({ left: 0, width: 0 });

	// biome-ignore lint/correctness/useExhaustiveDependencies: activeTab and tabs are re-measure triggers — they move the selected tab and resize the badges in the DOM read by measure().
	useEffect(() => {
		const container = tabsRef.current;
		if (!container) return;
		const measure = () => {
			const activeEl = container.querySelector<HTMLButtonElement>(
				'[aria-selected="true"]',
			);
			if (!activeEl) return;
			setIndicator({
				left: activeEl.offsetLeft,
				width: activeEl.offsetWidth,
			});
		};
		measure();
		// Il contenitore cambia misura col viewport, ma anche quando arriva il
		// font: le etichette si allargano senza nessun resize della finestra.
		const observer = new ResizeObserver(measure);
		observer.observe(container);
		let alive = true;
		void document.fonts?.ready.then(() => {
			if (alive) measure();
		});
		return () => {
			alive = false;
			observer.disconnect();
		};
	}, [activeTab, tabs]);

	// Tablist APG con attivazione automatica: un solo Tab entra nel gruppo, le
	// frecce (e Home/End) spostano focus e selezione insieme.
	const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		const current = tabs.findIndex((t) => t.value === activeTab);
		const next = targetIndex(event.key, Math.max(current, 0), tabs.length);
		if (next === null) return;
		event.preventDefault();
		const buttons =
			tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		buttons?.[next]?.focus();
		onTabChange(tabs[next].value);
	};

	return (
		<div className="relative border-b border-border" ref={tabsRef}>
			<div className="flex items-center justify-between">
				<div
					role="tablist"
					aria-label={label}
					className="-mb-px flex items-center gap-0.5"
				>
					{tabs.map((tab) => {
						const isActive = activeTab === tab.value;
						const colorKey = tab.badgeColor ?? "default";
						return (
							<button
								key={tab.value}
								type="button"
								role="tab"
								aria-selected={isActive}
								aria-controls={panelId}
								tabIndex={isActive ? 0 : -1}
								onKeyDown={onKeyDown}
								onClick={() => onTabChange(tab.value)}
								className={cn(
									"group relative inline-flex items-center gap-2 rounded-t-md px-4 py-2.5 text-sm whitespace-nowrap transition-all duration-150 focus-visible:focus-ring",
									isActive
										? "font-semibold text-primary"
										: "font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground",
								)}
							>
								{tab.label}
								{tab.count !== undefined && tab.count !== null && (
									<span
										className={cn(
											"inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-px text-xs font-medium tabular-nums transition-opacity duration-150",
											BADGE_COLORS[colorKey] ?? BADGE_COLORS.default,
											!isActive && "opacity-70 group-hover:opacity-100",
										)}
									>
										{tab.count}
									</span>
								)}
							</button>
						);
					})}
				</div>
				{children && <div className="flex items-center pb-1">{children}</div>}
			</div>

			{/* Sliding indicator */}
			<div
				className="absolute bottom-0 h-[2px] bg-primary transition-[left,width,opacity] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]"
				style={{
					left: indicator.left,
					width: indicator.width,
					opacity: indicator.width > 0 ? 1 : 0,
				}}
			/>
		</div>
	);
}
