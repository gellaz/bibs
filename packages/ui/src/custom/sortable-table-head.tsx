import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "~/lib/utils";

type SortOrder = "asc" | "desc";

interface SortableHeadButtonProps {
	/** Whether this column is currently sorted */
	active?: boolean;
	/** Current sort direction when active */
	sortOrder?: SortOrder;
	/** Called when the header is clicked */
	onSort?: () => void;
	/** Extra class for the button */
	className?: string;
	children?: React.ReactNode;
}

/**
 * Inner sortable-head button — renders the click target and the up/down icon
 * but **does not** wrap in a `<TableHead>`. Use this inside a TanStack column
 * `header` renderer, where `DataTable` already provides the `<th>` wrapper.
 */
function SortableHeadButton({
	active,
	sortOrder,
	onSort,
	children,
	className,
}: SortableHeadButtonProps) {
	const Icon = active
		? sortOrder === "asc"
			? ArrowUpIcon
			: ArrowDownIcon
		: ChevronsUpDownIcon;

	return (
		<button
			type="button"
			onClick={onSort}
			className={cn(
				"flex h-10 w-full cursor-pointer items-center gap-1 px-2 text-left font-medium transition-colors select-none",
				active ? "text-foreground" : "text-foreground hover:text-foreground/80",
				className,
			)}
		>
			{children}
			<Icon
				className={cn(
					"size-3.5 shrink-0",
					active ? "text-foreground" : "text-muted-foreground/60",
				)}
			/>
		</button>
	);
}

export type { SortOrder };
export { SortableHeadButton };
