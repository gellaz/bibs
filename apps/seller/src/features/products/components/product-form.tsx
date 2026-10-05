import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { toast } from "@bibs/ui/components/sonner";
import { Textarea } from "@bibs/ui/components/textarea";
import { formatPriceEur, scorporoDisplay } from "@bibs/ui/custom/price";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { FormSection } from "@/components/form-section";
import { api, unwrap } from "@/lib/api";
import { typeboxResolver } from "@/lib/typebox-resolver";
import { m } from "@/paraglide/messages";
import { useCategoryCharacteristics } from "../hooks/use-category-characteristics";
import {
	buildCharacteristicPayload,
	type CharacteristicFormValue,
	type CharacteristicFormValues,
	lostOnSave,
	requiredToFill,
	type SavedCharacteristicValue,
	toFormValues,
} from "../lib/characteristic-form";
import {
	CreateProductFormBody,
	type ProductFormData,
} from "../lib/product-form-schema";
import { BrandCombobox, type BrandComboboxValue } from "./brand-combobox";
import { CharacteristicLossDialog } from "./characteristic-loss-dialog";
import {
	ProductCategoryPicker,
	useProductMacroCategories,
} from "./product-category-picker";
import { ProductCharacteristicsSection } from "./product-characteristics-section";
import {
	type ExistingImage,
	ProductImageDropzone,
} from "./product-image-dropzone";

const compiledSchema = TypeCompiler.Compile(CreateProductFormBody);

export type { ExistingImage };

export interface ProductFormValues extends ProductFormData {
	files: File[];
	imageOrder?: string[];
	characteristicValues: {
		characteristicId: string;
		value: string | number | boolean | null;
	}[];
	/** Valori salvati che il cambio di sotto-categoria cancella, confermati. */
	confirmAffected: number;
}

export interface ProductFormDefaultValues {
	name: string;
	description?: string | null;
	price: string;
	vatRate?: "22" | "10" | "5" | "4" | "0";
	productCategoryId: string | null | undefined;
	ean?: string | null;
	brandId?: string | null;
	brandName?: string | null;
	macroCategoryId?: string | null;
}

interface ProductFormProps {
	defaultValues?: ProductFormDefaultValues;
	existingImages?: ExistingImage[];
	onDeleteExisting?: (imageId: string) => void;
	onSubmit: (values: ProductFormValues) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
	onNameChange?: (name: string) => void;
	savedCharacteristicValues?: SavedCharacteristicValue[];
}

const EAN_REGEX = /^(\d{8}|\d{13})$/;

export function ProductForm({
	defaultValues,
	existingImages = [],
	onDeleteExisting,
	onSubmit,
	onCancel,
	isPending,
	submitLabel,
	pendingLabel,
	onNameChange,
	savedCharacteristicValues,
}: ProductFormProps) {
	const isEdit = !!defaultValues;

	const {
		register,
		handleSubmit,
		setValue,
		watch,
		getValues,
		control,
		formState: { errors, isDirty },
	} = useForm<ProductFormData>({
		resolver: typeboxResolver(compiledSchema),
		defaultValues: {
			name: defaultValues?.name ?? "",
			description: defaultValues?.description ?? "",
			price: defaultValues?.price ?? "",
			vatRate: defaultValues?.vatRate ?? "22",
			productCategoryId: defaultValues?.productCategoryId,
			ean: defaultValues?.ean ?? undefined,
			brandId: defaultValues?.brandId ?? undefined,
			brandName: defaultValues?.brandName ?? undefined,
		},
	});

	const productCategoryId = watch("productCategoryId");
	const nameValue = watch("name");
	const eanValue = watch("ean") ?? "";
	const brandIdValue = watch("brandId");
	const brandNameValue = watch("brandName");

	useEffect(() => {
		onNameChange?.(nameValue);
	}, [nameValue, onNameChange]);

	const [macroCategoryId, setMacroCategoryId] = useState<string | null>(
		defaultValues?.macroCategoryId ?? null,
	);

	const [files, setFiles] = useState<File[]>([]);
	const [imageOrder, setImageOrder] = useState<string[] | undefined>();

	// Fuori da react-hook-form, inizializzato una volta: niente reset in un
	// effetto, che con riferimenti instabili desincronizza le select. Tiene i
	// valori di ogni caratteristica toccata, anche di una categoria poi
	// abbandonata: tornandoci prima di salvare non si perde nulla.
	const [characteristicValues, setCharacteristicValues] =
		useState<CharacteristicFormValues>(() =>
			toFormValues(savedCharacteristicValues ?? []),
		);
	const [characteristicsDirty, setCharacteristicsDirty] = useState(false);
	const [characteristicsOpen, setCharacteristicsOpen] = useState(false);
	const [characteristicErrors, setCharacteristicErrors] = useState<
		ReadonlySet<string>
	>(new Set());
	const [pendingSubmit, setPendingSubmit] = useState<ProductFormValues | null>(
		null,
	);

	const characteristics = useCategoryCharacteristics(productCategoryId);
	const definitions = productCategoryId ? characteristics.data : [];
	const saved = savedCharacteristicValues ?? [];
	const savedCategoryId = defaultValues?.productCategoryId ?? null;
	// Prodotto nuovo o sotto-categoria cambiata: tutte le obbligatorie (P1).
	const entering = !isEdit || (productCategoryId ?? null) !== savedCategoryId;
	// I valori fuori matrice si perdono solo se la categoria cambia davvero.
	const pendingLoss =
		isEdit && entering && definitions ? lostOnSave(saved, definitions) : [];

	const onCharacteristicChange = (
		characteristicId: string,
		value: CharacteristicFormValue,
	) => {
		setCharacteristicValues((prev) => ({ ...prev, [characteristicId]: value }));
		setCharacteristicsDirty(true);
		if (characteristicErrors.has(characteristicId)) {
			const next = new Set(characteristicErrors);
			next.delete(characteristicId);
			setCharacteristicErrors(next);
		}
	};

	const { data: macros = [] } = useProductMacroCategories();
	const eanLookupEnabled = !isEdit && EAN_REGEX.test(eanValue);
	const eanLookup = useQuery({
		queryKey: ["ean-lookup", eanValue],
		queryFn: async () => {
			const response = await api().seller.products.lookup.get({
				query: { ean: eanValue },
			});
			return unwrap(response, m.products_form_ean_lookup_error()).data;
		},
		enabled: eanLookupEnabled,
		staleTime: Number.POSITIVE_INFINITY,
	});

	const [lookupDismissed, setLookupDismissed] = useState(false);
	useEffect(() => {
		setLookupDismissed(false);
	}, [eanValue]);

	const lookupResult = eanLookup.data;
	const showLookupBanner =
		eanLookupEnabled && !!lookupResult && !lookupDismissed;

	const applyLookup = (overwrite: boolean) => {
		if (!lookupResult) return;
		const cur = getValues();
		if (overwrite || !cur.name)
			setValue("name", lookupResult.name, { shouldDirty: true });
		if (overwrite || !cur.description)
			setValue("description", lookupResult.description ?? "", {
				shouldDirty: true,
			});
		if (lookupResult.brandName && (overwrite || !brandIdValue)) {
			setValue("brandId", undefined, { shouldDirty: true });
			setValue("brandName", lookupResult.brandName, { shouldDirty: true });
		}
		if (overwrite || !macroCategoryId) {
			setMacroCategoryId(lookupResult.macroCategoryId);
			// Stessa regola della scelta a mano della macro: suggerisce
			// l'aliquota finché non è una scelta del seller.
			applySuggestedVatRate(
				macros.find((macro) => macro.id === lookupResult.macroCategoryId)
					?.suggestedVatRate,
			);
		}
		if (overwrite || !cur.productCategoryId) {
			setValue("productCategoryId", lookupResult.productCategoryId, {
				shouldValidate: true,
				shouldDirty: true,
			});
		}
		setLookupDismissed(true);
	};

	const hasAnyDirty =
		!!getValues("name") ||
		!!getValues("description") ||
		!!brandIdValue ||
		!!brandNameValue ||
		!!macroCategoryId ||
		!!getValues("productCategoryId");

	const handleDrop = useCallback(
		(acceptedFiles: File[]) => {
			setFiles((prev) => {
				const remaining = 10 - existingImages.length - prev.length;
				return [...prev, ...acceptedFiles.slice(0, Math.max(0, remaining))];
			});
		},
		[existingImages.length],
	);

	const removeFile = (index: number) => {
		setFiles((prev) => prev.filter((_, i) => i !== index));
	};

	const reorderFiles = (reordered: File[]) => {
		setFiles(reordered);
	};

	// The macro category only *suggests* a VAT rate. Once the rate is the
	// seller's own choice — picked in this form, or already saved on an edited
	// product — a category change must not overwrite a fiscal value silently.
	const vatRateChosen = useRef(isEdit);

	function applySuggestedVatRate(
		suggestedVatRate: "22" | "10" | "5" | "4" | "0" | undefined,
	) {
		if (!suggestedVatRate) return;
		const current = getValues("vatRate");
		if (!vatRateChosen.current) {
			setValue("vatRate", suggestedVatRate, { shouldDirty: true });
		} else if (current !== suggestedVatRate) {
			toast.info(
				m.products_form_vat_kept({
					current: current ?? "",
					suggested: suggestedVatRate,
				}),
			);
		}
	}

	const onMacroChange = (
		next: string | null,
		suggestedVatRate?: "22" | "10" | "5" | "4" | "0",
	) => {
		const hadCategory = !!productCategoryId;
		setMacroCategoryId(next);
		setValue("productCategoryId", undefined, {
			shouldValidate: true,
			shouldDirty: true,
		});
		applySuggestedVatRate(suggestedVatRate);
		if (hadCategory && next !== macroCategoryId) {
			toast.info(m.products_form_category_reset());
		}
	};

	const onBrandChange = (next: BrandComboboxValue | null) => {
		setValue("brandId", next?.brandId, {
			shouldValidate: true,
			shouldDirty: true,
		});
		setValue("brandName", next?.brandName, {
			shouldValidate: true,
			shouldDirty: true,
		});
	};

	const onFormSubmit: SubmitHandler<ProductFormData> = (data) => {
		if (!definitions) {
			// Il caricamento fallito lascia il pulsante attivo (isLoading è false):
			// un avviso più il retry, non un click che non fa nulla.
			if (characteristics.isError) {
				toast.error(m.products_form_characteristics_load_error());
				void characteristics.refetch();
			}
			// Mentre la matrice carica il pulsante è già disabilitato: è una rete.
			return;
		}

		const missing = requiredToFill({
			defs: definitions,
			values: characteristicValues,
			savedIds: new Set(saved.map((v) => v.characteristicId)),
			entering,
		});
		if (missing.length > 0) {
			setCharacteristicErrors(new Set(missing.map((d) => d.id)));
			setCharacteristicsOpen(true);
			const names = missing.map((d) => d.name).join(", ");
			toast.error(
				entering
					? m.products_form_characteristics_required({ names })
					: m.products_form_characteristics_cannot_clear({ names }),
			);
			return;
		}
		setCharacteristicErrors(new Set());

		// data.price is validated to `^\d+(\.\d{1,2})?$`; normalize to exactly two
		// decimals (e.g. `9` → `9.00`, `9.9` → `9.90`) for the strict API schema.
		const price = data.price.includes(".")
			? data.price.padEnd(data.price.indexOf(".") + 3, "0")
			: `${data.price}.00`;
		const values: ProductFormValues = {
			...data,
			ean: data.ean || undefined,
			price,
			files,
			imageOrder,
			characteristicValues: buildCharacteristicPayload(
				definitions,
				characteristicValues,
			),
			confirmAffected: 0,
		};
		// D10: la conferma arriva qui, con il numero che il server confronterà.
		if (pendingLoss.length > 0) {
			setPendingSubmit(values);
			return;
		}
		onSubmit(values);
	};

	const brandValue: BrandComboboxValue | null =
		brandIdValue || brandNameValue
			? { brandId: brandIdValue, brandName: brandNameValue }
			: null;

	return (
		<form onSubmit={handleSubmit(onFormSubmit)} className="@container">
			<div className="grid gap-x-10 gap-y-8 @2xl:grid-cols-[minmax(0,1fr)_18rem]">
				{/* Main column: the editable data */}
				<div className="space-y-8">
					<FormSection
						title={m.products_form_section_details()}
						description={m.products_form_section_details_description()}
						grid
					>
						<Field className="col-span-full" data-invalid={!!errors.name}>
							<FieldLabel htmlFor="product-name" required>
								{m.common_name()}
							</FieldLabel>
							<Input
								id="product-name"
								placeholder={
									isEdit ? undefined : m.products_form_name_placeholder()
								}
								autoFocus={!isEdit}
								{...register("name")}
							/>
							<FieldError errors={[errors.name]} />
						</Field>

						<Field data-invalid={!!errors.ean}>
							<FieldLabel htmlFor="product-ean">EAN</FieldLabel>
							<Input
								id="product-ean"
								placeholder={m.products_form_ean_placeholder()}
								inputMode="numeric"
								{...register("ean")}
							/>
							<FieldError errors={[errors.ean]} />
							{showLookupBanner && (
								<div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-cobalt/20 bg-cobalt-soft p-2 text-sm">
									<span className="flex-1 text-cobalt-deep">
										{m.products_form_ean_found()}
									</span>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => applyLookup(hasAnyDirty)}
									>
										{hasAnyDirty
											? m.products_form_ean_fill_overwrite()
											: m.products_form_ean_fill()}
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => setLookupDismissed(true)}
									>
										{m.products_form_ean_ignore()}
									</Button>
								</div>
							)}
						</Field>

						<Field>
							<FieldLabel htmlFor="product-brand">
								{m.products_form_brand_label()}
							</FieldLabel>
							<BrandCombobox
								id="product-brand"
								value={brandValue}
								onChange={onBrandChange}
							/>
						</Field>

						<Field className="col-span-full">
							<FieldLabel htmlFor="product-description">
								{m.products_form_description_label()}
							</FieldLabel>
							<Textarea
								id="product-description"
								placeholder={
									isEdit ? undefined : m.products_form_description_placeholder()
								}
								rows={2}
								{...register("description")}
							/>
						</Field>
					</FormSection>

					<FormSection
						title={m.products_form_section_price()}
						description={m.products_form_section_price_description()}
						grid
					>
						<Field data-invalid={!!errors.price}>
							<FieldLabel htmlFor="product-price" required>
								{m.products_form_price_label()}
							</FieldLabel>
							<Input
								id="product-price"
								type="number"
								step="0.01"
								min="0.01"
								placeholder={isEdit ? undefined : "9.99"}
								{...register("price")}
							/>
							<FieldError errors={[errors.price]} />
						</Field>

						<Field>
							<FieldLabel htmlFor="product-vat-rate">
								{m.products_form_vat_label()}
							</FieldLabel>
							<Controller
								control={control}
								name="vatRate"
								render={({ field }) => (
									<Select
										value={field.value}
										onValueChange={(value) => {
											vatRateChosen.current = true;
											field.onChange(value);
										}}
									>
										<SelectTrigger id="product-vat-rate" className="w-full">
											<SelectValue placeholder="22%" />
										</SelectTrigger>
										<SelectContent>
											{["22", "10", "5", "4", "0"].map((r) => (
												<SelectItem key={r} value={r}>
													{r}%
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}
							/>
						</Field>

						{(() => {
							const rate = Number(watch("vatRate"));
							const { net, vat } = scorporoDisplay(watch("price") ?? "", rate);
							if (!Number.isFinite(net)) return null;
							return (
								<p className="col-span-full text-muted-foreground text-xs">
									{m.products_form_vat_breakdown({
										net: formatPriceEur(net),
										vat: formatPriceEur(vat),
										rate,
									})}
								</p>
							);
						})()}
					</FormSection>

					<FormSection
						title={m.products_form_section_catalog()}
						description={m.products_form_section_catalog_description()}
					>
						<div className="space-y-4">
							<Field data-invalid={!!errors.productCategoryId}>
								<ProductCategoryPicker
									macroCategoryId={macroCategoryId}
									categoryId={productCategoryId}
									onCategoryChange={(id) =>
										setValue("productCategoryId", id, {
											shouldValidate: true,
											shouldDirty: true,
										})
									}
									onMacroChange={onMacroChange}
								/>
								<FieldError errors={[errors.productCategoryId]} />
							</Field>

							{definitions && (
								<ProductCharacteristicsSection
									definitions={definitions}
									values={characteristicValues}
									onChange={onCharacteristicChange}
									errorIds={characteristicErrors}
									open={characteristicsOpen}
									onOpenChange={setCharacteristicsOpen}
									pendingLoss={pendingLoss}
								/>
							)}
						</div>
					</FormSection>
				</div>

				{/* Aside column: media */}
				<div className="space-y-8">
					<FormSection
						title={m.products_form_section_images()}
						description={m.products_form_section_images_description()}
					>
						<ProductImageDropzone
							files={files}
							onDrop={handleDrop}
							onRemoveFile={removeFile}
							onReorderFiles={reorderFiles}
							existingImages={existingImages}
							onDeleteExisting={onDeleteExisting}
							onReorderExisting={setImageOrder}
						/>
					</FormSection>
				</div>
			</div>

			<div className="mt-8 flex justify-end gap-3 border-t pt-5">
				<Button type="button" variant="outline" onClick={onCancel}>
					{m.common_cancel()}
				</Button>
				<Button
					type="submit"
					disabled={
						isPending ||
						(!!productCategoryId && characteristics.isLoading) ||
						(!isDirty &&
							files.length === 0 &&
							imageOrder === undefined &&
							!characteristicsDirty)
					}
				>
					{isPending ? pendingLabel : submitLabel}
				</Button>
			</div>

			<CharacteristicLossDialog
				lost={pendingLoss}
				open={pendingSubmit !== null}
				onCancel={() => setPendingSubmit(null)}
				onConfirm={() => {
					if (pendingSubmit) {
						onSubmit({ ...pendingSubmit, confirmAffected: pendingLoss.length });
					}
					setPendingSubmit(null);
				}}
			/>
		</form>
	);
}
