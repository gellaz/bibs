import { Button } from "@bibs/ui/components/button";
import { Separator } from "@bibs/ui/components/separator";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { cn } from "@bibs/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { StoreIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import { FormSection } from "@/components/form-section";
import { CancelStoreDialog } from "@/features/billing/components/cancel-store-dialog";
import {
	type ExistingImage,
	ProductImageDropzone,
} from "@/features/products/components/product-image-dropzone";
import { LowStockThresholdSection } from "@/features/stores/components/low-stock-threshold-section";
import { OrderTypesSection } from "@/features/stores/components/order-types-section";
import {
	StoreForm,
	type StoreFormData,
} from "@/features/stores/components/store-form";
import { useActiveStore } from "@/hooks/use-active-store";
import { useIsOwner } from "@/hooks/use-is-owner";
import { municipalitiesQueryOptions } from "@/hooks/use-municipalities";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/store/")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(municipalitiesQueryOptions()),
	component: StoreSettingsPage,
});

const MAX_STORE_IMAGES = 8;

function StoreSettingsPage() {
	const { activeStore, activeSubscription } = useActiveStore();
	const isOwner = useIsOwner();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const handleNameChange = useCallback((value: string) => setName(value), []);
	const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
	const [existingImages, setExistingImages] = useState<ExistingImage[]>([]);
	const [newFiles, setNewFiles] = useState<File[]>([]);
	const [imagesStoreId, setImagesStoreId] = useState<string | undefined>(
		undefined,
	);

	const storeId = activeStore?.id;

	const {
		data: store,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["store", storeId],
		queryFn: async () => {
			if (!storeId) throw new Error(m.store_no_active());
			const response = await api().seller.stores.get({
				query: { page: 1, limit: 100 },
			});
			const data = unwrap(response, m.store_load_error());
			const found = data.data.find((s) => s.id === storeId);
			if (!found) throw new Error(m.store_not_found());
			return found;
		},
		enabled: !!storeId,
	});

	// Re-derive image state whenever the active store changes. The store is
	// switched in place (StoreSwitcher only mutates context — no navigation), so
	// without this the dropzone would keep showing the previous store's images
	// and any queued uploads.
	if (store && imagesStoreId !== storeId) {
		setExistingImages(
			(store.images ?? []).map((img) => ({ id: img.id, url: img.url })),
		);
		setNewFiles([]);
		// Clear the typed-name override so the header falls back to the newly
		// selected store's name (the keyed StoreForm re-emits it on remount).
		setName("");
		setImagesStoreId(storeId);
	}

	const deleteImageMutation = useMutation({
		mutationFn: async (imageId: string) => {
			if (!storeId) throw new Error(m.store_no_active());
			const response = await api()
				.seller.stores({ storeId })
				.images({ imageId })
				.delete();
			if (response.error) throw new Error(m.store_image_delete_error());
		},
		onSuccess: (_data, imageId) => {
			setExistingImages((prev) => prev.filter((img) => img.id !== imageId));
			toast.success(m.store_image_deleted());
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const updateMutation = useMutation({
		mutationFn: async (formData: StoreFormData) => {
			if (!storeId) throw new Error(m.store_no_active());
			const response = await api().seller.stores({ storeId }).patch(formData);
			const data = unwrap(response, m.store_update_error());
			if (newFiles.length > 0) {
				const imgResponse = await api()
					.seller.stores({ storeId })
					.images.post({ files: newFiles });
				if (imgResponse.error) {
					toast.warning(m.store_update_images_warning());
				}
				setNewFiles([]);
			}
			return data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["stores"] });
			void queryClient.invalidateQueries({ queryKey: ["store", storeId] });
			toast.success(m.store_updated());
			setLastSavedAt(Date.now());
		},
		onError: (error: Error) =>
			toast.error(error.message || m.store_update_error_generic()),
	});

	if (!activeStore) {
		return (
			<div className="bg-muted text-muted-foreground rounded-lg border p-4 text-sm">
				{m.store_no_active()}
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
					{(error as Error)?.message || m.store_not_found()}
				</p>
			</div>
		);
	}

	const storeForm = (
		<StoreForm
			key={activeStore.id}
			defaultValues={{
				name: store.name,
				description: store.description ?? "",
				addressLine1: store.addressLine1,
				addressLine2: store.addressLine2 ?? "",
				municipalityId: store.municipalityId,
				zipCode: store.zipCode,
				location: store.location ?? undefined,
				// undefined (non ""): "" presente fallirebbe il format uri dello
				// schema Optional — vedi il default in store-form.tsx.
				websiteUrl: store.websiteUrl ?? undefined,
				// null a DB = nessun orario impostato → l'editor parte con tutti i
				// giorni chiusi (lo stato VERO), non con i default di comodo che
				// altrimenti verrebbero persistiti da un save non correlato.
				openingHours: (store.openingHours as never) ?? [],
				phoneNumbers: store.phoneNumbers.map((p) => ({
					label: p.label ?? "",
					number: p.number,
					position: p.position,
				})),
			}}
			onSubmit={(data) => updateMutation.mutate(data)}
			isPending={updateMutation.isPending}
			submitLabel={m.store_settings_save()}
			pendingLabel={m.store_settings_saving()}
			onNameChange={handleNameChange}
			readOnly={!isOwner}
			lastSavedAt={lastSavedAt}
		/>
	);

	return (
		<div
			className={cn(
				"mx-auto w-full space-y-10",
				isOwner ? "max-w-7xl" : "max-w-3xl",
			)}
		>
			<EntityFormHeader
				icon={StoreIcon}
				title={name || store.name}
				placeholder={m.store_settings_title()}
				subtitle={
					isOwner
						? m.store_settings_subtitle()
						: m.store_settings_subtitle_readonly()
				}
			/>

			{isOwner ? (
				<div className="@container">
					<div className="grid gap-x-10 gap-y-8 @2xl:grid-cols-[minmax(0,1fr)_18rem]">
						<div className="min-w-0">{storeForm}</div>
						<div className="space-y-8">
							<FormSection
								title={m.store_showcase_title()}
								description={m.store_showcase_description({
									max: MAX_STORE_IMAGES,
								})}
							>
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
							</FormSection>
							<OrderTypesSection
								key={activeStore.id}
								storeId={activeStore.id}
							/>
							<LowStockThresholdSection
								key={`low-stock-${activeStore.id}`}
								storeId={activeStore.id}
								value={store.lowStockThreshold}
							/>
						</div>
					</div>
				</div>
			) : (
				storeForm
			)}

			{isOwner && (
				<Link
					to="/store/closures"
					className="inline-flex items-center gap-2 text-sm font-medium text-foreground underline-offset-4 hover:underline"
				>
					{m.store_closures_link()} →
				</Link>
			)}

			{isOwner &&
				activeStore &&
				activeSubscription &&
				activeSubscription.status !== "canceled" &&
				activeSubscription.status !== "canceling" && (
					<>
						<Separator />
						<FormSection
							title={m.store_danger_title()}
							description={m.store_danger_description()}
							tone="destructive"
						>
							<div className="rounded-lg border border-destructive/30 p-4">
								<h3 className="text-sm font-semibold text-destructive">
									{m.store_delete_title()}
								</h3>
								<p className="mt-1 text-sm text-muted-foreground">
									{activeSubscription.status === "suspended"
										? m.store_delete_suspended()
										: m.store_delete_active()}
								</p>
								<CancelStoreDialog
									storeId={activeStore.id}
									storeName={activeStore.name}
									status={
										activeSubscription.status as
											| "active"
											| "past_due"
											| "suspended"
									}
									currentPeriodEnd={activeSubscription.currentPeriodEnd}
									trigger={
										<Button variant="destructive" className="mt-3">
											{m.store_delete_title()}
										</Button>
									}
								/>
							</div>
						</FormSection>
					</>
				)}
		</div>
	);
}
