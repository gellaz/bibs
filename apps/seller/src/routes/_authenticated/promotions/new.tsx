import { toast } from "@bibs/ui/components/sonner";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import {
	DiscountForm,
	type DiscountFormValues,
} from "@/features/promotions/components/discount-form";
import { sellerApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/promotions/new")({
	component: NewPromotionPage,
});

function NewPromotionPage() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [title, setTitle] = useState<string>("");

	const createMutation = useMutation({
		mutationFn: async (values: DiscountFormValues) => {
			// Le `Date` escono come stringhe ISO (JSON.stringify), come con Eden.
			const res = await sellerApi.discounts.$post({
				json: {
					title: values.title,
					percent: values.percent,
					startsAt: new Date(values.startsAt),
					endsAt:
						values.noEndDate || !values.endsAt ? null : new Date(values.endsAt),
				},
			});
			return (await unwrapJson(res, m.common_error())).data;
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
		<div className="mx-auto w-full max-w-2xl space-y-6 p-4 xl:p-6">
			<EntityFormHeader
				mode="create"
				title={title}
				placeholder={m.promotions_new_title()}
				subtitle={m.promotions_new_subtitle()}
			/>

			<DiscountForm
				submitLabel={m.promotions_form_submit_new()}
				submitting={createMutation.isPending}
				onTitleChange={setTitle}
				onCancel={() =>
					void navigate({
						to: "/promotions",
						search: { page: 1, limit: 20, state: "assignable" as const },
					})
				}
				onSubmit={async (v) => {
					await createMutation.mutateAsync(v);
				}}
			/>
		</div>
	);
}
