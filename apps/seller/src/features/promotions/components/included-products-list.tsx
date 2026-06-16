import { Button } from "@bibs/ui/components/button";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { formatPriceEur } from "@bibs/ui/components/price";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { Link } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState } from "react";
import {
	useDiscountProducts,
	useRemoveDiscountProducts,
} from "@/features/promotions/hooks/use-discounts";
import { m } from "@/paraglide/messages";

const PAGE_SIZE = 20;

interface Props {
	discountId: string;
}

export function IncludedProductsList({ discountId }: Props) {
	const [page, setPage] = useState(1);
	const query = useDiscountProducts(discountId, page, PAGE_SIZE);
	const remove = useRemoveDiscountProducts(discountId);

	const rows = query.data?.data ?? [];
	const total = query.data?.pagination.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	const onRemove = (productId: string) => {
		remove.mutate([productId], {
			onSuccess: (res) =>
				toast.success(
					m.promotions_toast_products_removed({ count: res.data.removed }),
				),
			onError: (e) => toast.error((e as Error).message),
		});
	};

	if (query.isLoading) {
		return (
			<div className="flex h-48 items-center justify-center">
				<Spinner className="size-6" />
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center">
				<p className="text-muted-foreground text-sm">
					{m.promotions_included_empty()}
				</p>
				<Button asChild variant="link" size="sm">
					<Link
						to="/products"
						search={{ page: 1, limit: 20, statusFilter: "active" }}
					>
						{m.promotions_included_add_hint()}
					</Link>
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="overflow-hidden rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Nome</TableHead>
							<TableHead className="text-right">Prezzo</TableHead>
							<TableHead className="w-12 pr-4" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow key={row.id}>
								<TableCell className="font-medium">{row.name}</TableCell>
								<TableCell className="text-right text-sm tabular-nums">
									<span className="inline-flex items-baseline gap-2">
										<span className="text-muted-foreground line-through">
											{formatPriceEur(row.originalPrice)}
										</span>
										<span className="text-foreground font-semibold">
											{formatPriceEur(row.discountedPrice)}
										</span>
									</span>
								</TableCell>
								<TableCell className="pr-4 text-right">
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={m.promotions_included_remove()}
										disabled={remove.isPending}
										onClick={() => onRemove(row.id)}
									>
										<XIcon className="size-4" />
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{totalPages > 1 && (
				<DataPagination
					page={page}
					totalPages={totalPages}
					onPageChange={setPage}
				/>
			)}
		</div>
	);
}
