import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "~/components/button";
import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
} from "~/components/pagination";
import { clampPage } from "~/lib/pagination-search";
import { cn } from "~/lib/utils";

interface DataPaginationProps {
	/** Current page (1-indexed) */
	page: number;
	/** Total number of pages */
	totalPages: number;
	/**
	 * Callback when page changes. `replace` is set when the component itself
	 * pulls an out-of-range page back in: a URL-backed consumer should replace
	 * the history entry, or Back lands on the bad page and bounces forward again.
	 */
	onPageChange: (page: number, options?: { replace?: boolean }) => void;
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
	const current = clampPage(page, totalPages);

	// Una pagina fuori intervallo viene riportata dentro. Solo con almeno una
	// pagina: a 0 il totale può non essere ancora arrivato, e correggere lì
	// butterebbe via la pagina di un link mentre la lista carica.
	useEffect(() => {
		if (totalPages >= 1 && page !== current)
			onPageChange(current, { replace: true });
	}, [page, current, totalPages, onPageChange]);

	if (totalPages <= 1) return null;

	const pages = generatePageRange(current, totalPages, siblingCount);

	return (
		<Pagination className={cn("justify-start", className)}>
			<PaginationContent className="gap-1">
				<PaginationItem>
					<Button
						variant="ghost"
						size="icon"
						disabled={current <= 1}
						onClick={() => onPageChange(current - 1)}
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

					const isActive = item === current;
					return (
						<PaginationItem key={item}>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => onPageChange(item)}
								aria-label={`Pagina ${item}`}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"tabular-nums",
									isActive &&
										"bg-foreground text-background hover:bg-foreground/90 hover:text-background font-semibold cursor-default",
								)}
							>
								{item}
							</Button>
						</PaginationItem>
					);
				})}

				<PaginationItem>
					<Button
						variant="ghost"
						size="icon"
						disabled={current >= totalPages}
						onClick={() => onPageChange(current + 1)}
						aria-label="Pagina successiva"
					>
						<ChevronRightIcon className="size-4" />
					</Button>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}

export type { DataPaginationProps };
export { DataPagination };
