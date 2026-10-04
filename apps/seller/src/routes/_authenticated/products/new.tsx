import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import {
	ProductForm,
	type ProductFormValues,
} from "@/features/products/components/product-form";
import { useActiveStore } from "@/hooks/use-active-store";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/products/new")({
	component: NewProductPage,
});

function NewProductPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { activeStore } = useActiveStore();
	const [name, setName] = useState("");
	const handleNameChange = useCallback((value: string) => setName(value), []);

	const goBack = () =>
		void navigate({
			to: "/products",
			search: { page: 1, limit: 20, statusFilter: "active" },
		});

	const createMutation = useMutation({
		mutationFn: async (formData: ProductFormValues) => {
			const storeId = activeStore?.id;
			if (!storeId) throw new Error(m.products_new_no_store());
			const response = await api().seller.products.post({
				name: formData.name,
				description: formData.description,
				price: formData.price,
				vatRate: formData.vatRate,
				productCategoryId: formData.productCategoryId ?? null,
				ean: formData.ean,
				brandId: formData.brandId,
				brandName: formData.brandName,
				characteristicValues: formData.characteristicValues,
				storeId,
			});

			const product = unwrap(response, m.products_new_create_error());

			if (formData.files.length > 0 && product.data?.id) {
				const imgResponse = await api()
					.seller.products({ productId: product.data.id })
					.images.post({ files: formData.files });

				if (imgResponse.error) {
					toast.warning(m.products_new_images_upload_error());
				}
			}

			return product;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["products"] });
			void queryClient.invalidateQueries({
				queryKey: ["seller-categories-in-use"],
			});
			void queryClient.invalidateQueries({ queryKey: ["seller-brands"] });
			toast.success(
				activeStore
					? m.products_new_success_in_store({ storeName: activeStore.name })
					: m.products_new_success(),
			);
			goBack();
		},
		onError: (error: Error) => {
			toast.error(error.message || m.products_new_error());
		},
	});

	return (
		<div className="mx-auto w-full max-w-7xl space-y-10">
			<EntityFormHeader
				mode="create"
				title={name}
				placeholder={m.products_new_cta()}
				subtitle={m.products_new_subtitle()}
			/>

			<ProductForm
				onSubmit={(values) => createMutation.mutate(values)}
				onCancel={goBack}
				isPending={createMutation.isPending || !activeStore}
				submitLabel={m.products_new_submit()}
				pendingLabel={m.products_new_submitting()}
				onNameChange={handleNameChange}
			/>
		</div>
	);
}
