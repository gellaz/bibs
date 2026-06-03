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
import { api } from "@/lib/api";

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
			if (!storeId) throw new Error("Nessun negozio selezionato");
			const response = await api().seller.products.post({
				name: formData.name,
				description: formData.description,
				price: formData.price,
				vatRate: formData.vatRate,
				categoryIds: formData.categoryIds,
				ean: formData.ean,
				brandId: formData.brandId,
				brandName: formData.brandName,
				storeId,
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nella creazione",
				);
			}

			const product = response.data;

			if (formData.files.length > 0 && product.data?.id) {
				const imgResponse = await api()
					.seller.products({ productId: product.data.id })
					.images.post({ files: formData.files });

				if (imgResponse.error) {
					toast.warning("Prodotto creato ma errore nel caricamento immagini");
				}
			}

			return product;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["products"] });
			void queryClient.invalidateQueries({ queryKey: ["seller-brands"] });
			toast.success(
				activeStore
					? `Prodotto creato in ${activeStore.name}`
					: "Prodotto creato con successo",
			);
			goBack();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante la creazione");
		},
	});

	return (
		<div className="mx-auto w-full max-w-7xl space-y-10">
			<EntityFormHeader
				mode="create"
				title={name}
				placeholder="Nuovo Prodotto"
				subtitle="Aggiungi un nuovo prodotto al catalogo"
			/>

			<ProductForm
				onSubmit={(values) => createMutation.mutate(values)}
				onCancel={goBack}
				isPending={createMutation.isPending || !activeStore}
				submitLabel="Crea Prodotto"
				pendingLabel="Creazione..."
				onNameChange={handleNameChange}
			/>
		</div>
	);
}
