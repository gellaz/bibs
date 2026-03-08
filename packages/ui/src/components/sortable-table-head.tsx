import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import type * as React from "react";
import { TableHead } from "~/components/table";
import { cn } from "~/lib/utils";

type SortOrder = "asc" | "desc";

interface SortableTableHeadProps
	extends React.ComponentProps<typeof TableHead> {
	/** Whether this column is currently sorted */
	active?: boolean;
	/** Current sort direction when active */
	sortOrder?: SortOrder;
	/** Called when the header is clicked */
	onSort?: () => void;
}

function SortableTableHead({
	active,
	sortOrder,
	onSort,
	children,
	className,
	...props
}: SortableTableHeadProps) {
	const Icon = active
		? sortOrder === "asc"
			? ArrowUpIcon
			: ArrowDownIcon
		: ChevronsUpDownIcon;

	return (
		<TableHead className={cn("p-0", className)} {...props}>
			<button
				type="button"
				onClick={onSort}
				className={cn(
					"flex h-10 w-full cursor-pointer items-center gap-1 px-2 text-left font-medium transition-colors select-none",
					active
						? "text-foreground"
						: "text-foreground hover:text-foreground/80",
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
		</TableHead>
	);
}

export { SortableTableHead };
export type { SortableTableHeadProps, SortOrder };
