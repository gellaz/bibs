"use client";

import { Columns3Icon, LockIcon } from "lucide-react";
import { Fragment } from "react";

import { Button } from "~/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/dropdown-menu";
import type { ColumnVisibility } from "~/hooks/use-column-visibility";

interface TableColumnsToggleProps<TId extends string = string> {
	visibility: ColumnVisibility<TId>;
	/** Side to align the menu against the trigger. Default `"end"`. */
	align?: "start" | "center" | "end";
	/** Italian default. Override if the surrounding label is in English. */
	labels?: {
		trigger?: string;
		menuTitle?: string;
		reset?: string;
		locked?: string;
	};
	className?: string;
}

const DEFAULT_LABELS = {
	trigger: "Colonne visibili",
	menuTitle: "Colonne",
	reset: "Ripristina predefinite",
	locked: "Sempre visibile",
} as const;

/**
 * Trigger + dropdown that lets the user pick which columns of a data table
 * are visible. The state is owned by `useColumnVisibility`; this component is
 * the chrome around it.
 *
 * Designed to sit inside the last `<th>` of a `<TableHeader>` row, so the
 * affordance travels with the table header and stays anchored right.
 */
export function TableColumnsToggle<TId extends string>({
	visibility,
	align = "end",
	labels: labelOverrides,
	className,
}: TableColumnsToggleProps<TId>) {
	const labels = { ...DEFAULT_LABELS, ...labelOverrides };
	const { columns, isVisible, toggle, reset, visibleCount, hideableCount } =
		visibility;

	const isAtDefault = columns.every((col) => {
		if (col.locked) return true;
		const fallback = col.defaultVisible ?? true;
		return isVisible(col.id) === fallback;
	});

	// Group the columns while preserving the order in `columns`.
	const groups: Array<{
		key: string;
		label: string | undefined;
		items: typeof columns;
	}> = [];
	for (const col of columns) {
		const groupKey = col.group ?? "";
		const last = groups[groups.length - 1];
		if (last && last.key === groupKey) {
			last.items = [...last.items, col];
		} else {
			groups.push({ key: groupKey, label: col.group, items: [col] });
		}
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={labels.trigger}
					title={labels.trigger}
					className={className}
				>
					<Columns3Icon />
				</Button>
			</DropdownMenuTrigger>

			<DropdownMenuContent align={align} className="min-w-56">
				<div className="flex items-center justify-between gap-2 px-1.5 py-1">
					<DropdownMenuLabel className="px-0 py-0 normal-case tracking-normal text-foreground text-sm font-semibold">
						{labels.menuTitle}
					</DropdownMenuLabel>
					<span
						aria-hidden="true"
						className="text-muted-foreground text-xs tabular-nums"
					>
						{visibleCount}/{columns.length}
					</span>
				</div>
				<DropdownMenuSeparator />

				{groups.map((group, groupIdx) => (
					<Fragment key={group.key || `g-${groupIdx}`}>
						{group.label ? (
							<DropdownMenuLabel className="pt-2">
								{group.label}
							</DropdownMenuLabel>
						) : null}
						{group.items.map((col) => {
							const checked = isVisible(col.id);
							const locked = col.locked ?? false;
							return (
								<DropdownMenuCheckboxItem
									key={col.id}
									checked={checked}
									disabled={locked}
									onSelect={(event) => event.preventDefault()}
									onCheckedChange={() => toggle(col.id)}
								>
									<span className="flex-1 truncate">{col.label}</span>
									{locked ? (
										<LockIcon
											aria-label={labels.locked}
											className="text-muted-foreground/70 mr-5"
										/>
									) : null}
								</DropdownMenuCheckboxItem>
							);
						})}
					</Fragment>
				))}

				{hideableCount > 0 ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onSelect={(event) => {
								event.preventDefault();
								reset();
							}}
							disabled={isAtDefault}
						>
							{labels.reset}
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
