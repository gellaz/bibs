import { cn } from "@bibs/ui/lib/utils";
import { useEffect, useRef, useState } from "react";

const BADGE_COLORS: Record<string, string> = {
	default: "bg-foreground/5 text-foreground/70 border border-foreground/15",
	amber:
		"bg-amber-50 text-amber-700 border border-amber-300/50 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30",
	emerald:
		"bg-emerald-50 text-emerald-700 border border-emerald-300/50 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30",
	red: "bg-red-50 text-red-700 border border-red-300/50 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/30",
};

export interface TabItem {
	value: string;
	label: string;
	count?: number | null;
	badgeColor?: string;
}

interface TabNavProps {
	tabs: TabItem[];
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
				<div role="tablist" className="flex gap-1">
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
									"relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									isActive
										? "text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{tab.label}
								{tab.count !== undefined && tab.count !== null && (
									<span
										className={cn(
											"inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
											BADGE_COLORS[colorKey] ?? BADGE_COLORS.default,
										)}
									>
										{tab.count}
									</span>
								)}
							</button>
						);
					})}
				</div>
				{children && <div className="flex items-center">{children}</div>}
			</div>
			{/* Animated sliding underline */}
			<div
				className="absolute bottom-0 h-0.5 rounded-full bg-primary transition-all duration-300 ease-in-out"
				style={{
					left: indicator.left,
					width: indicator.width,
					opacity: indicator.width > 0 ? 1 : 0,
				}}
			/>
		</div>
	);
}
