import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import { SectionHeader } from "@/components/section-header";
import {
	DiscountForm,
	type DiscountFormValues,
} from "@/features/promotions/components/discount-form";
import { ProductSelector } from "@/features/promotions/components/product-selector";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/promotions/new")({
	component: NewPromotionPage,
});

function NewPromotionPage() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [productIds, setProductIds] = useState<string[]>([]);
	const [percent, setPercent] = useState<number>(10);
	const [title, setTitle] = useState<string>("");

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
		<div className="-m-4 xl:flex xl:h-full xl:flex-col">
			<div className="grid xl:flex-1 xl:grid-cols-[2fr_3fr] xl:gap-x-0">
				<div className="space-y-6 p-4 pb-6 xl:p-6">
					<EntityFormHeader
						mode="create"
						title={title}
						placeholder="Nuova Promozione"
						subtitle="Configura una nuova promozione"
					/>

					<DiscountForm
						submitLabel={m.promotions_form_submit_new()}
						submitting={createMutation.isPending}
						onPercentChange={setPercent}
						onTitleChange={setTitle}
						onCancel={() =>
							void navigate({
								to: "/promotions",
								search: { page: 1, limit: 20, state: "all" as const },
							})
						}
						onSubmit={async (v) => {
							await createMutation.mutateAsync(v);
						}}
					/>
				</div>

				<section className="space-y-6 border-t p-4 pt-6 xl:border-t-0 xl:border-l xl:p-6">
					<SectionHeader
						title={m.promotions_section_products_title()}
						subtitle={m.promotions_section_products_subtitle()}
					/>
					<ProductSelector
						mode={{
							kind: "local",
							percent,
							includedIds: productIds,
							onChange: setProductIds,
						}}
					/>
				</section>
			</div>
		</div>
	);
}
