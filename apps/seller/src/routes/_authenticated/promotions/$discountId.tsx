import { Button } from "@bibs/ui/components/button";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DiscountForm } from "@/features/promotions/components/discount-form";
import { IncludedProductsTable } from "@/features/promotions/components/included-products-table";
import { ProductPickerSheet } from "@/features/promotions/components/product-picker-sheet";
import {
	useAddDiscountProducts,
	useArchiveDiscount,
	useDiscount,
	useDiscountProducts,
	usePauseDiscount,
	useRemoveDiscountProducts,
	useUpdateDiscount,
} from "@/features/promotions/hooks/use-discounts";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/promotions/$discountId")({
	component: PromotionDetailPage,
});

function PromotionDetailPage() {
	const { discountId } = Route.useParams();
	const detail = useDiscount(discountId);
	const update = useUpdateDiscount(discountId);
	const pause = usePauseDiscount();
	const archive = useArchiveDiscount();
	const addProducts = useAddDiscountProducts(discountId);
	const removeProducts = useRemoveDiscountProducts(discountId);
	const products = useDiscountProducts(discountId);
	const [pickerOpen, setPickerOpen] = useState(false);

	if (detail.isLoading) return <Spinner />;
	if (!detail.data) return <div>Promozione non trovata</div>;

	const d = detail.data.data;
	const isStarted = new Date(d.startsAt).getTime() <= Date.now();

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">{d.title}</h1>
				<div className="flex gap-2">
					{d.status !== "archived" && (
						<Button
							variant="outline"
							onClick={() =>
								pause.mutate(discountId, {
									onSuccess: () =>
										toast.success(
											d.status === "paused"
												? m.promotions_toast_resumed()
												: m.promotions_toast_paused(),
										),
								})
							}
						>
							{d.status === "paused"
								? m.promotions_action_resume()
								: m.promotions_action_pause()}
						</Button>
					)}
					{d.status !== "archived" && (
						<Button
							variant="destructive"
							onClick={() =>
								archive.mutate(discountId, {
									onSuccess: () => toast.success(m.promotions_toast_archived()),
								})
							}
						>
							{m.promotions_action_archive()}
						</Button>
					)}
				</div>
			</div>

			<DiscountForm
				defaultValues={{
					title: d.title,
					percent: d.percent,
					startsAt: new Date(d.startsAt).toISOString().slice(0, 16),
					endsAt: d.endsAt ? new Date(d.endsAt).toISOString().slice(0, 16) : "",
					noEndDate: !d.endsAt,
				}}
				disablePercent={isStarted}
				disableStartsAt={isStarted}
				submitLabel={m.promotions_form_submit_edit()}
				submitting={update.isPending}
				onSubmit={async (v) => {
					await update.mutateAsync({
						title: v.title,
						percent: isStarted ? undefined : v.percent,
						startsAt: isStarted ? undefined : new Date(v.startsAt),
						endsAt: v.noEndDate || !v.endsAt ? null : new Date(v.endsAt),
					});
					toast.success(m.promotions_toast_updated());
				}}
			/>

			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<h2 className="font-medium">
						{m.promotions_form_products_section()}
					</h2>
					<Button onClick={() => setPickerOpen(true)}>
						{m.promotions_form_add_products()}
					</Button>
				</div>
				{products.data && (
					<IncludedProductsTable
						rows={products.data.data}
						percent={d.percent}
						onRemove={(ids) =>
							removeProducts.mutate(ids, {
								onSuccess: (r) =>
									toast.success(
										m.promotions_toast_products_removed({
											count: r.data.removed,
										}),
									),
							})
						}
					/>
				)}
			</div>

			<ProductPickerSheet
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				excludeDiscountId={discountId}
				onConfirm={(ids) =>
					addProducts.mutate(ids, {
						onSuccess: (r) =>
							toast.success(
								m.promotions_toast_products_added({
									added: r.data.added,
									alreadyPresent: r.data.alreadyPresent,
									rejected: r.data.rejected.length,
								}),
							),
					})
				}
			/>
		</div>
	);
}
