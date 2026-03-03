import { Button } from "@bibs/ui/components/button";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import {
	ProductForm,
	type ProductFormValues,
} from "@/features/products/components/product-form";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/products/new")({
	component: NewProductPage,
});

function NewProductPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const goBack = () =>
		void navigate({ to: "/products", search: { page: 1, limit: 20 } });

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

	const createMutation = useMutation({
		mutationFn: async (formData: ProductFormValues) => {
			const response = await api().seller.products.post({
				name: formData.name,
				description: formData.description,
				price: formData.price,
				categoryIds: formData.categoryIds,
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
			toast.success("Prodotto creato con successo");
			goBack();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante la creazione");
		},
	});

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-4">
				<Button variant="ghost" size="icon" onClick={goBack}>
					<ArrowLeftIcon />
				</Button>
				<div>
					<h1 className="text-2xl font-bold">Nuovo Prodotto</h1>
					<p className="text-muted-foreground text-sm">
						Inserisci i dati del nuovo prodotto
					</p>
				</div>
			</div>

			<ProductForm
				categories={categories ?? []}
				onSubmit={(values) => createMutation.mutate(values)}
				onCancel={goBack}
				isPending={createMutation.isPending}
				submitLabel="Crea Prodotto"
				pendingLabel="Creazione..."
			/>
		</div>
	);
}
