import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	DiscountForm,
	type DiscountFormValues,
} from "@/features/promotions/components/discount-form";
import { ProductPickerSheet } from "@/features/promotions/components/product-picker-sheet";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/promotions/new")({
	component: NewPromotionPage,
});

function NewPromotionPage() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [productIds, setProductIds] = useState<string[]>([]);
	const [pickerOpen, setPickerOpen] = useState(false);

	const createMutation = useMutation({
		mutationFn: async (values: DiscountFormValues) => {
			const res = await api().seller.discounts.post({
				title: values.title,
				percent: values.percent,
				startsAt: new Date(values.startsAt),
				endsAt:
					values.noEndDate || !values.endsAt ? null : new Date(values.endsAt),
				initialProductIds: productIds.length > 0 ? productIds : undefined,
			});
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data.data;
		},
		onSuccess: (d) => {
			toast.success(m.promotions_toast_created());
			void qc.invalidateQueries({ queryKey: ["discounts"] });
			void navigate({
				to: "/promotions/$discountId",
				params: { discountId: d.id },
			});
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">{m.promotions_form_submit_new()}</h1>

			<DiscountForm
				submitLabel={m.promotions_form_submit_new()}
				submitting={createMutation.isPending}
				onSubmit={async (v) => {
					await createMutation.mutateAsync(v);
				}}
			/>

			<div className="space-y-2">
				<h2 className="font-medium">{m.promotions_form_products_section()}</h2>
				<p className="text-muted-foreground text-sm">
					{m.promotions_form_products_count({ count: productIds.length })}
				</p>
				<button
					type="button"
					className="text-primary text-sm hover:underline"
					onClick={() => setPickerOpen(true)}
				>
					{m.promotions_form_add_products()}
				</button>
			</div>

			<ProductPickerSheet
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				alreadySelectedIds={new Set(productIds)}
				onConfirm={(ids) =>
					setProductIds((prev) => Array.from(new Set([...prev, ...ids])))
				}
			/>
		</div>
	);
}
