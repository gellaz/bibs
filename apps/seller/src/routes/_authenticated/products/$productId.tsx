import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PencilIcon } from "lucide-react";
import { useCallback, useState } from "react";
import {
	type ExistingImage,
	ProductForm,
	type ProductFormValues,
} from "@/features/products/components/product-form";
import { api } from "@/lib/api";

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
		void navigate({ to: "/products", search: { page: 1, limit: 20 } });

	const {
		data: product,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["product", productId],
		queryFn: async () => {
			const response = await api().seller.products({ productId }).get();

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento prodotto",
				);
			}

			return response.data.data;
		},
	});

	const { data: categories } = useQuery({
		queryKey: ["categories"],
		queryFn: async () => {
			const response = await api().categories.get({
				query: { page: 1, limit: 100 },
			});

			if (response.error) {
				throw new Error("Errore nel caricamento categorie");
			}

			return response.data.data;
		},
	});

	// Initialize existing images from loaded product (once)
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
			const response = await api().seller.products({ productId }).patch({
				name: formData.name,
				description: formData.description,
				price: formData.price,
				categoryIds: formData.categoryIds,
				imageOrder: formData.imageOrder,
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nell'aggiornamento",
				);
			}

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

			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["products"] });
			void queryClient.invalidateQueries({ queryKey: ["product", productId] });
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
			<div className="bg-destructive/10 text-destructive rounded-lg border border-destructive/20 p-4">
				<p className="text-sm">
					{(error as Error)?.message || "Prodotto non trovato"}
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">
						{name || (
							<span className="text-muted-foreground">Modifica Prodotto</span>
						)}
					</h1>
					<p className="text-muted-foreground text-sm">Modifica prodotto</p>
				</div>
				<div className="bg-primary flex size-10 items-center justify-center rounded-lg">
					<PencilIcon className="text-primary-foreground size-5" />
				</div>
			</div>

			<ProductForm
				defaultValues={{
					name: product.name,
					description: product.description,
					price: product.price,
					categoryIds: product.productClassifications.map(
						(pc) => pc.productCategoryId,
					),
				}}
				categories={categories ?? []}
				existingImages={existingImages}
				onDeleteExisting={(imageId) => deleteImageMutation.mutate(imageId)}
				onSubmit={(values) => updateMutation.mutate(values)}
				onCancel={goBack}
				isPending={updateMutation.isPending}
				submitLabel="Salva Modifiche"
				pendingLabel="Salvataggio..."
				onNameChange={handleNameChange}
			/>
		</div>
	);
}
