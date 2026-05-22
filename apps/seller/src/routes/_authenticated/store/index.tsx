import { Separator } from "@bibs/ui/components/separator";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
	type ExistingImage,
	ProductImageDropzone,
} from "@/features/products/components/product-image-dropzone";
import {
	StoreForm,
	type StoreFormData,
} from "@/features/stores/components/store-form";
import { useActiveStore } from "@/hooks/use-active-store";
import { useIsOwner } from "@/hooks/use-is-owner";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/store/")({
	component: StoreSettingsPage,
});

const MAX_STORE_IMAGES = 8;

function StoreSettingsPage() {
	const { activeStore } = useActiveStore();
	const isOwner = useIsOwner();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const handleNameChange = useCallback((value: string) => setName(value), []);
	const [existingImages, setExistingImages] = useState<ExistingImage[]>([]);
	const [newFiles, setNewFiles] = useState<File[]>([]);
	const [imagesInitialized, setImagesInitialized] = useState(false);

	const storeId = activeStore?.id;

	const {
		data: store,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["store", storeId],
		queryFn: async () => {
			if (!storeId) throw new Error("No active store");
			const response = await api().seller.stores.get({
				query: { page: 1, limit: 100 },
			});
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento negozio",
				);
			}
			const found = response.data.data.find((s) => s.id === storeId);
			if (!found) throw new Error("Negozio non trovato");
			return found;
		},
		enabled: !!storeId,
	});

	if (store && !imagesInitialized) {
		setExistingImages(
			(store.images ?? []).map((img) => ({ id: img.id, url: img.url })),
		);
		setImagesInitialized(true);
	}

	const deleteImageMutation = useMutation({
		mutationFn: async (imageId: string) => {
			if (!storeId) throw new Error("No active store");
			const response = await api()
				.seller.stores({ storeId })
				.images({ imageId })
				.delete();
			if (response.error) throw new Error("Errore nell'eliminazione immagine");
		},
		onSuccess: (_data, imageId) => {
			setExistingImages((prev) => prev.filter((img) => img.id !== imageId));
			toast.success("Immagine eliminata");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const updateMutation = useMutation({
		mutationFn: async (formData: StoreFormData) => {
			if (!storeId) throw new Error("No active store");
			const response = await api().seller.stores({ storeId }).patch(formData);
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nell'aggiornamento",
				);
			}
			if (newFiles.length > 0) {
				const imgResponse = await api()
					.seller.stores({ storeId })
					.images.post({ files: newFiles });
				if (imgResponse.error) {
					toast.warning(
						"Negozio aggiornato ma errore nel caricamento immagini",
					);
				}
				setNewFiles([]);
			}
			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["stores"] });
			void queryClient.invalidateQueries({ queryKey: ["store", storeId] });
			toast.success("Negozio aggiornato con successo");
		},
		onError: (error: Error) =>
			toast.error(error.message || "Errore durante l'aggiornamento"),
	});

	if (!activeStore) {
		return (
			<div className="bg-muted text-muted-foreground rounded-lg border p-4 text-sm">
				Nessun negozio selezionato.
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	if (error || !store) {
		return (
			<div className="bg-destructive/10 text-destructive rounded-lg border border-destructive/20 p-4">
				<p className="text-sm">
					{(error as Error)?.message || "Negozio non trovato"}
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-5xl space-y-10">
			<header className="space-y-1">
				<h1 className="font-display text-2xl font-semibold tracking-tight">
					{name || store.name || (
						<span className="text-muted-foreground">Impostazioni negozio</span>
					)}
				</h1>
				<p className="text-muted-foreground text-sm">
					{isOwner
						? "Modifica le informazioni del negozio attivo."
						: "Informazioni del negozio (sola lettura)."}
				</p>
			</header>

			{isOwner && (
				<>
					<section className="grid gap-6 md:grid-cols-[18rem_1fr] md:gap-12">
						<div className="space-y-1.5">
							<h2 className="font-display text-base font-semibold tracking-tight text-foreground">
								Vetrina
							</h2>
							<p className="text-sm leading-relaxed text-muted-foreground">
								Le foto del negozio che i clienti vedono per primi. Fino a{" "}
								{MAX_STORE_IMAGES}, riordinabili.
							</p>
						</div>
						<ProductImageDropzone
							files={newFiles}
							onDrop={(accepted) =>
								setNewFiles((prev) => [
									...prev,
									...accepted.slice(
										0,
										MAX_STORE_IMAGES - existingImages.length - prev.length,
									),
								])
							}
							onRemoveFile={(index) =>
								setNewFiles((prev) => prev.filter((_, i) => i !== index))
							}
							onReorderFiles={setNewFiles}
							existingImages={existingImages}
							onDeleteExisting={(imageId) =>
								deleteImageMutation.mutate(imageId)
							}
							maxFiles={MAX_STORE_IMAGES}
						/>
					</section>
					<Separator />
				</>
			)}

			<StoreForm
				defaultValues={{
					name: store.name,
					description: store.description ?? "",
					addressLine1: store.addressLine1,
					addressLine2: store.addressLine2 ?? "",
					city: store.city,
					zipCode: store.zipCode,
					province: store.province ?? "",
					websiteUrl: store.websiteUrl ?? "",
					openingHours: (store.openingHours as never) ?? undefined,
					phoneNumbers: store.phoneNumbers.map((p) => ({
						label: p.label ?? "",
						number: p.number,
						position: p.position,
					})),
				}}
				onSubmit={(data) => updateMutation.mutate(data)}
				onCancel={() => {}}
				isPending={updateMutation.isPending}
				submitLabel="Salva Modifiche"
				pendingLabel="Salvataggio..."
				onNameChange={handleNameChange}
				readOnly={!isOwner}
			/>
		</div>
	);
}
