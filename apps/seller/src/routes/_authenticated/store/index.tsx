import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { TabNav } from "@bibs/ui/custom/tab-nav";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { StoreIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { EntityFormHeader } from "@/components/entity-form-header";
import { FormSection } from "@/components/form-section";
import {
	type ExistingImage,
	ProductImageDropzone,
} from "@/features/products/components/product-image-dropzone";
import { HoursClosuresPanel } from "@/features/stores/components/hours-closures-panel";
import { SalesSettingsPanel } from "@/features/stores/components/sales-settings-panel";
import {
	StoreForm,
	type StoreFormData,
} from "@/features/stores/components/store-form";
import { useActiveStore } from "@/hooks/use-active-store";
import { useIsOwner } from "@/hooks/use-is-owner";
import { municipalitiesQueryOptions } from "@/hooks/use-municipalities";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

export type StoreSection = "profilo" | "orari" | "vendita";
const SECTIONS: StoreSection[] = ["profilo", "orari", "vendita"];

export const Route = createFileRoute("/_authenticated/store/")({
	// Scheda aperta: assente = Profilo negozio.
	validateSearch: (
		search: Record<string, unknown>,
	): { sezione?: StoreSection } =>
		SECTIONS.includes(search.sezione as StoreSection)
			? { sezione: search.sezione as StoreSection }
			: {},
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(municipalitiesQueryOptions()),
	component: StoreSettingsPage,
});

const MAX_STORE_IMAGES = 8;

function StoreSettingsPage() {
	const { activeStore } = useActiveStore();
	const isOwner = useIsOwner();
	const { sezione } = Route.useSearch();
	const navigate = Route.useNavigate();
	const tabs = [
		{ value: "profilo", label: m.store_tab_profile() },
		{ value: "orari", label: m.store_tab_hours() },
		// Vendita è del titolare: l'API risponde 403 al dipendente.
		...(isOwner ? [{ value: "vendita", label: m.store_tab_sales() }] : []),
	];
	const active: StoreSection = tabs.some((t) => t.value === sezione)
		? (sezione as StoreSection)
		: "profilo";
	const [visited, setVisited] = useState(() => new Set([active]));
	if (!visited.has(active)) setVisited(new Set(visited).add(active));
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
				} else {
					// Le foto caricate passano tra le esistenti: senza, sparirebbero
					// dalla vetrina fino al prossimo cambio di negozio.
					const uploaded = imgResponse.data.data;
					setExistingImages((prev) => [
						...prev,
						...uploaded.map((img) => ({ id: img.id, url: img.url })),
					]);
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
			hideHours
			extraDirty={newFiles.length > 0}
			leading={
				isOwner && (
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
				)
			}
		/>
	);

	return (
		<div className="mx-auto w-full max-w-7xl space-y-8">
			<EntityFormHeader
				icon={StoreIcon}
				title={name || store.name}
				placeholder={m.store_settings_title()}
				subtitle={
					isOwner
						? m.store_settings_subtitle()
						: m.store_settings_subtitle_readonly()
				}
				bordered={false}
			/>

			<div className="overflow-x-auto">
				<TabNav
					label={m.store_tabs_label()}
					panelId="store-settings-panel"
					tabs={tabs}
					activeTab={active}
					onTabChange={(next) =>
						void navigate({
							search: (s) => ({ ...s, sezione: next as StoreSection }),
							replace: true,
						})
					}
				/>
			</div>

			{/* Le schede già aperte restano montate (solo nascoste): cambiare
			    scheda non butta le modifiche non salvate. */}
			<div id="store-settings-panel" role="tabpanel">
				{visited.has("profilo") && (
					<div hidden={active !== "profilo"} className="max-w-3xl">
						{storeForm}
					</div>
				)}
				{visited.has("orari") && (
					<div hidden={active !== "orari"}>
						<HoursClosuresPanel
							key={activeStore.id}
							storeId={activeStore.id}
							openingHours={(store.openingHours as never) ?? []}
							readOnly={!isOwner}
						/>
					</div>
				)}
				{isOwner && visited.has("vendita") && (
					<div hidden={active !== "vendita"}>
						<SalesSettingsPanel
							key={activeStore.id}
							storeId={activeStore.id}
							reservationHours={store.reservationHours}
							lowStockThreshold={store.lowStockThreshold}
							hasOpeningHours={
								store.openingHours?.some((d) => d.slots.length > 0) ?? false
							}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
