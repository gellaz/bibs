import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { RadioGroup, RadioGroupItem } from "@bibs/ui/components/radio-group";
import { ScrollArea } from "@bibs/ui/components/scroll-area";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { cn } from "@bibs/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PromotionStateBadge } from "@/features/promotions/components/promotion-state-badge";
import {
	useApplyPromotionToProducts,
	useDiscountsList,
} from "@/features/promotions/hooks/use-discounts";
import { m } from "@/paraglide/messages";

const PERIOD_FMT: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "short",
};

function fmtPeriod(
	startsAt: string | Date,
	endsAt: string | Date | null,
): string {
	const s = new Date(startsAt).toLocaleDateString("it-IT", PERIOD_FMT);
	const e = endsAt
		? new Date(endsAt).toLocaleDateString("it-IT", PERIOD_FMT)
		: "∞";
	return `${s} → ${e}`;
}

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	productIds: string[];
	onSuccess?: () => void;
}

export function ApplyPromotionDialog({
	open,
	onOpenChange,
	productIds,
	onSuccess,
}: Props) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const list = useDiscountsList({ page: 1, limit: 100, state: "assignable" });
	const apply = useApplyPromotionToProducts();

	// Reset selection on every open (also covers cancel).
	useEffect(() => {
		if (open) setSelectedId(null);
	}, [open]);

	const promotions = list.data?.data ?? [];

	const onApply = () => {
		if (!selectedId) return;
		const promo = promotions.find((p) => p.id === selectedId);
		apply.mutate(
			{ discountId: selectedId, productIds },
			{
				onSuccess: (res) => {
					const r = res.data;
					toast.success(
						m.products_apply_promotion_success({
							added: r.added,
							alreadyPresent: r.alreadyPresent,
							title: promo?.title ?? "",
						}),
					);
					if (r.rejected.length > 0) {
						toast.warning(
							m.products_apply_promotion_rejected({
								count: r.rejected.length,
							}),
						);
					}
					onSuccess?.();
					onOpenChange(false);
				},
				onError: (e) => toast.error((e as Error).message),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{m.products_apply_promotion_title({ count: productIds.length })}
					</DialogTitle>
					<DialogDescription>
						{m.products_apply_promotion_subtitle()}
					</DialogDescription>
				</DialogHeader>

				{list.isLoading ? (
					<div className="flex h-40 items-center justify-center">
						<Spinner className="size-6" />
					</div>
				) : promotions.length === 0 ? (
					<div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
						<p className="text-muted-foreground text-sm">
							{m.products_apply_promotion_empty()}
						</p>
						<Button asChild variant="outline" size="sm">
							<Link to="/promotions/new">{m.promotions_new_cta()}</Link>
						</Button>
					</div>
				) : (
					<ScrollArea className="-mx-1 max-h-72 px-1">
						<RadioGroup
							value={selectedId ?? undefined}
							onValueChange={setSelectedId}
							className="gap-2"
						>
							{promotions.map((p) => (
								<label
									key={p.id}
									htmlFor={`promo-${p.id}`}
									className={cn(
										"flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
										selectedId === p.id
											? "border-primary bg-primary/5"
											: "hover:bg-muted/40",
									)}
								>
									<RadioGroupItem id={`promo-${p.id}`} value={p.id} />
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<span className="truncate font-medium">{p.title}</span>
											<Badge variant="secondary">-{p.percent}%</Badge>
										</div>
										<div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs tabular-nums">
											<span>{fmtPeriod(p.startsAt, p.endsAt)}</span>
											<span>·</span>
											<span>
												{m.products_apply_promotion_product_count({
													count: p.productCount,
												})}
											</span>
										</div>
									</div>
									<PromotionStateBadge
										status={p.status}
										startsAt={p.startsAt}
										endsAt={p.endsAt}
									/>
								</label>
							))}
						</RadioGroup>
					</ScrollArea>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						{m.common_cancel()}
					</Button>
					<Button
						type="button"
						onClick={onApply}
						disabled={!selectedId || apply.isPending}
					>
						{m.products_apply_promotion_confirm()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
