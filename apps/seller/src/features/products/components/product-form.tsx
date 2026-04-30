import { CreateProductBody } from "@bibs/api/schemas";
import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { Separator } from "@bibs/ui/components/separator";
import { toast } from "@bibs/ui/components/sonner";
import { Textarea } from "@bibs/ui/components/textarea";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { api } from "@/lib/api";
import { BrandCombobox, type BrandComboboxValue } from "./brand-combobox";
import { ProductCategoriesPicker } from "./product-categories-picker";
import {
	type ExistingImage,
	ProductImageDropzone,
} from "./product-image-dropzone";

type ProductFormData = Static<typeof CreateProductBody>;
const compiledSchema = TypeCompiler.Compile(CreateProductBody);

export type { ExistingImage };

export interface ProductFormValues extends ProductFormData {
	files: File[];
	imageOrder?: string[];
}

export interface ProductFormDefaultValues {
	name: string;
	description?: string | null;
	price: string;
	categoryIds: string[];
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
}: ProductFormProps) {
	const isEdit = !!defaultValues;

	const {
		register,
		handleSubmit,
		setValue,
		watch,
		getValues,
		formState: { errors },
	} = useForm<ProductFormData>({
		resolver: typeboxResolver(compiledSchema),
		defaultValues: {
			name: defaultValues?.name ?? "",
			description: defaultValues?.description ?? "",
			price: defaultValues?.price ?? "",
			categoryIds: defaultValues?.categoryIds ?? [],
			ean: defaultValues?.ean ?? undefined,
			brandId: defaultValues?.brandId ?? undefined,
			brandName: defaultValues?.brandName ?? undefined,
		},
	});

	const selectedCategories = watch("categoryIds") ?? [];
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

	const eanLookupEnabled = !isEdit && EAN_REGEX.test(eanValue);
	const eanLookup = useQuery({
		queryKey: ["ean-lookup", eanValue],
		queryFn: async () => {
			const response = await api().seller.products.lookup.get({
				query: { ean: eanValue },
			});
			if (response.error) throw new Error("Errore lookup EAN");
			return response.data.data;
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
		if (overwrite || !cur.name) setValue("name", lookupResult.name);
		if (overwrite || !cur.description)
			setValue("description", lookupResult.description ?? "");
		if (lookupResult.brandName && (overwrite || !brandIdValue)) {
			setValue("brandId", undefined);
			setValue("brandName", lookupResult.brandName);
		}
		if (overwrite || !macroCategoryId) {
			setMacroCategoryId(lookupResult.macroCategoryId);
		}
		if (overwrite || (cur.categoryIds ?? []).length === 0) {
			setValue("categoryIds", lookupResult.categoryIds, {
				shouldValidate: true,
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
		(getValues("categoryIds") ?? []).length > 0;

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

	const toggleCategory = (categoryId: string) => {
		const current = selectedCategories;
		const next = current.includes(categoryId)
			? current.filter((id) => id !== categoryId)
			: [...current, categoryId];
		setValue("categoryIds", next, { shouldValidate: true });
	};

	const onMacroChange = (next: string | null) => {
		const hadCategories = selectedCategories.length > 0;
		setMacroCategoryId(next);
		setValue("categoryIds", [], { shouldValidate: true });
		if (hadCategories && next !== macroCategoryId) {
			toast.info("Categorie resettate per via del cambio di macrocategoria");
		}
	};

	const onBrandChange = (next: BrandComboboxValue | null) => {
		setValue("brandId", next?.brandId, { shouldValidate: true });
		setValue("brandName", next?.brandName, { shouldValidate: true });
	};

	const onFormSubmit: SubmitHandler<ProductFormData> = (data) => {
		const price = data.price.includes(".")
			? data.price
					.replace(/^(\d+\.\d{0,2}).*$/, "$1")
					.padEnd(data.price.indexOf(".") + 3, "0")
			: `${data.price}.00`;
		onSubmit({
			...data,
			ean: data.ean || undefined,
			price,
			files,
			imageOrder,
		});
	};

	const brandValue: BrandComboboxValue | null =
		brandIdValue || brandNameValue
			? { brandId: brandIdValue, brandName: brandNameValue }
			: null;

	return (
		<form onSubmit={handleSubmit(onFormSubmit)} className="space-y-5">
			<div className="grid gap-4 sm:grid-cols-2">
				<Field data-invalid={!!errors.ean} className="sm:col-span-2">
					<FieldLabel htmlFor="product-ean">EAN</FieldLabel>
					<Input
						id="product-ean"
						placeholder="8 o 13 cifre"
						inputMode="numeric"
						{...register("ean")}
					/>
					<FieldError errors={[errors.ean]} />
					{showLookupBanner && (
						<div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-sm">
							<span className="flex-1 text-blue-900">
								Trovato un prodotto esistente per questo EAN.
							</span>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => applyLookup(hasAnyDirty)}
							>
								{hasAnyDirty ? "Compila campi (sovrascrive)" : "Compila campi"}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() => setLookupDismissed(true)}
							>
								Ignora
							</Button>
						</div>
					)}
				</Field>

				<Field data-invalid={!!errors.name} className="sm:col-span-2">
					<FieldLabel htmlFor="product-name" required>
						Nome
					</FieldLabel>
					<Input
						id="product-name"
						placeholder={isEdit ? undefined : "Es. Pizza Margherita"}
						autoFocus={!isEdit}
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>

				<Field className="sm:col-span-2">
					<FieldLabel htmlFor="product-description">Descrizione</FieldLabel>
					<Textarea
						id="product-description"
						placeholder={
							isEdit ? undefined : "Descrizione del prodotto (opzionale)"
						}
						rows={2}
						{...register("description")}
					/>
				</Field>

				<Field data-invalid={!!errors.price}>
					<FieldLabel htmlFor="product-price" required>
						Prezzo (€)
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

				<Field className="sm:col-span-2">
					<FieldLabel>Brand</FieldLabel>
					<BrandCombobox value={brandValue} onChange={onBrandChange} />
				</Field>
			</div>

			<Separator />

			<Field data-invalid={!!errors.categoryIds}>
				<ProductCategoriesPicker
					macroCategoryId={macroCategoryId}
					categoryIds={selectedCategories ?? []}
					onMacroChange={onMacroChange}
					onToggleCategory={toggleCategory}
				/>
				<FieldError errors={[errors.categoryIds]} />
			</Field>

			<Separator />

			<ProductImageDropzone
				files={files}
				onDrop={handleDrop}
				onRemoveFile={removeFile}
				onReorderFiles={reorderFiles}
				existingImages={existingImages}
				onDeleteExisting={onDeleteExisting}
				onReorderExisting={setImageOrder}
			/>

			<div className="flex justify-end gap-3 pt-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					Annulla
				</Button>
				<Button type="submit" disabled={isPending}>
					{isPending ? pendingLabel : submitLabel}
				</Button>
			</div>
		</form>
	);
}
