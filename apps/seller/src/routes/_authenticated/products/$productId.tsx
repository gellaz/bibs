import { Separator } from "@bibs/ui/components/separator";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import { FormSection } from "@/components/form-section";
import {
	type ExistingImage,
	ProductForm,
	type ProductFormValues,
} from "@/features/products/components/product-form";
import { ProductStockManager } from "@/features/products/components/product-stock-manager";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/products/$productId")({
	component: EditProductPage,
});

function EditProductPage() {
	const { productId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [existingImages, setExistingImages] = useState<ExistingImage[]>([]);
	const [initialized, setInitialized] = useState(false);
	const [name, setName] = useState("");
	const handleNameChange = useCallback((value: string) => setName(value), []);

	const goBack = () =>
		void navigate({
			to: "/products",
			search: { page: 1, limit: 20, statusFilter: "active" },
		});

	const {
		data: product,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["product", productId],
		queryFn: async () => {
			const response = await api().seller.products({ productId }).get();

			return unwrap(response, "Errore nel caricamento prodotto").data;
		},
	});

	if (product && !initialized) {
		setExistingImages(
			product.images.map((img) => ({ id: img.id, url: img.url })),
		);
		setInitialized(true);
	}

	const deleteImageMutation = useMutation({
		mutationFn: async (imageId: string) => {
			const response = await api()
				.seller.products({ productId })
				.images({ imageId })
				.delete();

			if (response.error) {
				throw new Error("Errore nell'eliminazione immagine");
			}
		},
		onSuccess: (_data, imageId) => {
			setExistingImages((prev) => prev.filter((img) => img.id !== imageId));
			toast.success("Immagine eliminata");
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	const updateMutation = useMutation({
		mutationFn: async (formData: ProductFormValues) => {
			const response = await api()
				.seller.products({ productId })
				.patch({
					name: formData.name,
					description: formData.description,
					price: formData.price,
					vatRate: formData.vatRate,
					categoryIds: formData.categoryIds,
					imageOrder: formData.imageOrder,
					ean: formData.ean ?? null,
					brandId: formData.brandId ?? null,
					brandName: formData.brandName,
				});

			const data = unwrap(response, "Errore nell'aggiornamento");

			if (formData.files.length > 0) {
				const imgResponse = await api()
					.seller.products({ productId })
					.images.post({ files: formData.files });

				if (imgResponse.error) {
					toast.warning(
						"Prodotto aggiornato ma errore nel caricamento immagini",
					);
				}
			}

			return data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["products"] });
			void queryClient.invalidateQueries({ queryKey: ["product", productId] });
			void queryClient.invalidateQueries({ queryKey: ["seller-brands"] });
			toast.success("Prodotto aggiornato con successo");
			goBack();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'aggiornamento");
		},
	});

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	if (error || !product) {
		return (
			<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
				<p className="text-sm">
					{(error as Error)?.message || "Prodotto non trovato"}
				</p>
			</div>
		);
	}

	const firstAssignment = product.productCategoryAssignments[0];
	const macroCategoryId = firstAssignment?.category.macroCategoryId ?? null;

	return (
		<div className="mx-auto w-full max-w-7xl space-y-10">
			<EntityFormHeader
				mode="edit"
				title={name || product.name}
				placeholder="Modifica Prodotto"
				subtitle="Aggiorna le informazioni del prodotto"
			/>

			<ProductForm
				defaultValues={{
					name: product.name,
					description: product.description,
					price: product.price,
					vatRate: product.vatRate,
					categoryIds: product.productCategoryAssignments.map(
						(a) => a.productCategoryId,
					),
					ean: product.ean,
					brandId: product.brand?.id,
					brandName: product.brand?.name,
					macroCategoryId,
				}}
				existingImages={existingImages}
				onDeleteExisting={(imageId) => deleteImageMutation.mutate(imageId)}
				onSubmit={(values) => updateMutation.mutate(values)}
				onCancel={goBack}
				isPending={updateMutation.isPending}
				submitLabel="Salva Modifiche"
				pendingLabel="Salvataggio..."
				onNameChange={handleNameChange}
			/>

			<Separator />

			<FormSection
				title={m.products_stock_manager_heading()}
				description={m.products_stock_manager_subtitle()}
			>
				<ProductStockManager
					productId={productId}
					storeProducts={product.storeProducts}
				/>
			</FormSection>
		</div>
	);
}
