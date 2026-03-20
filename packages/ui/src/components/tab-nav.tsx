"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

const BADGE_COLORS: Record<string, string> = {
	default:
		"bg-foreground/8 text-foreground/60 ring-1 ring-inset ring-foreground/10",
	amber:
		"bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-300/50 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30",
	emerald:
		"bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-300/50 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30",
	red: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-300/50 dark:bg-red-500/15 dark:text-red-400 dark:ring-red-500/30",
};

export interface TabNavItem {
	value: string;
	label: string;
	count?: number | null;
	badgeColor?: string;
}

interface TabNavProps {
	tabs: TabNavItem[];
	activeTab: string;
	onTabChange: (value: string) => void;
	children?: React.ReactNode;
}

export function TabNav({
	tabs,
	activeTab,
	onTabChange,
	children,
}: TabNavProps) {
	const tabsRef = useRef<HTMLDivElement>(null);
	const [indicator, setIndicator] = useState({ left: 0, width: 0 });

	useEffect(() => {
		const measure = () => {
			const container = tabsRef.current;
			if (!container) return;
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
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [activeTab, tabs]);

	return (
		<div className="relative border-b border-border" ref={tabsRef}>
			<div className="flex items-center justify-between">
				<div role="tablist" className="-mb-px flex items-center gap-0.5">
					{tabs.map((tab) => {
						const isActive = activeTab === tab.value;
						const colorKey = tab.badgeColor ?? "default";
						return (
							<button
								key={tab.value}
								type="button"
								role="tab"
								aria-selected={isActive}
								onClick={() => onTabChange(tab.value)}
								className={cn(
									"group relative inline-flex items-center gap-2 rounded-t-md px-4 py-2.5 text-sm whitespace-nowrap transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
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
