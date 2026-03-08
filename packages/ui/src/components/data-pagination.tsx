import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "~/components/button";
import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
} from "~/components/pagination";
import { cn } from "~/lib/utils";

interface DataPaginationProps {
	/** Current page (1-indexed) */
	page: number;
	/** Total number of pages */
	totalPages: number;
	/** Callback when page changes */
	onPageChange: (page: number) => void;
	/** Number of sibling pages to show on each side of current page. Default: 1 */
	siblingCount?: number;
	/** Additional class name */
	className?: string;
}

function generatePageRange(
	page: number,
	totalPages: number,
	siblingCount: number,
): (number | "ellipsis-start" | "ellipsis-end")[] {
	// Total slots: first + last + current + 2*siblings + 2 ellipsis
	const totalSlots = siblingCount * 2 + 5;

	if (totalPages <= totalSlots) {
		return Array.from({ length: totalPages }, (_, i) => i + 1);
	}

	const leftSibling = Math.max(page - siblingCount, 1);
	const rightSibling = Math.min(page + siblingCount, totalPages);

	const showLeftEllipsis = leftSibling > 2;
	const showRightEllipsis = rightSibling < totalPages - 1;

	if (!showLeftEllipsis && showRightEllipsis) {
		const leftCount = 3 + 2 * siblingCount;
		const leftRange = Array.from({ length: leftCount }, (_, i) => i + 1);
		return [...leftRange, "ellipsis-end" as const, totalPages];
	}

	if (showLeftEllipsis && !showRightEllipsis) {
		const rightCount = 3 + 2 * siblingCount;
		const rightRange = Array.from(
			{ length: rightCount },
			(_, i) => totalPages - rightCount + i + 1,
		);
		return [1, "ellipsis-start" as const, ...rightRange];
	}

	const middleRange = Array.from(
		{ length: rightSibling - leftSibling + 1 },
		(_, i) => leftSibling + i,
	);
	return [
		1,
		"ellipsis-start" as const,
		...middleRange,
		"ellipsis-end" as const,
		totalPages,
	];
}

function DataPagination({
	page,
	totalPages,
	onPageChange,
	siblingCount = 1,
	className,
}: DataPaginationProps) {
	if (totalPages <= 1) return null;

	const pages = generatePageRange(page, totalPages, siblingCount);

	return (
		<Pagination className={cn("justify-start", className)}>
			<PaginationContent>
				<PaginationItem>
					<Button
						variant="outline"
						size="icon-sm"
						disabled={page <= 1}
						onClick={() => onPageChange(page - 1)}
						aria-label="Pagina precedente"
					>
						<ChevronLeftIcon className="size-4" />
					</Button>
				</PaginationItem>

				{pages.map((item) => {
					if (item === "ellipsis-start" || item === "ellipsis-end") {
						return (
							<PaginationItem key={item}>
								<PaginationEllipsis />
							</PaginationItem>
						);
					}

					return (
						<PaginationItem key={item}>
							<Button
								variant={item === page ? "outline" : "ghost"}
								size="icon-sm"
								onClick={() => onPageChange(item)}
								aria-label={`Pagina ${item}`}
								aria-current={item === page ? "page" : undefined}
								className={cn(
									item === page && "border-primary/30 font-semibold",
								)}
							>
								{item}
							</Button>
						</PaginationItem>
					);
				})}

				<PaginationItem>
					<Button
						variant="outline"
						size="icon-sm"
						disabled={page >= totalPages}
						onClick={() => onPageChange(page + 1)}
						aria-label="Pagina successiva"
					>
						<ChevronRightIcon className="size-4" />
					</Button>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}

export { DataPagination };
export type { DataPaginationProps };
