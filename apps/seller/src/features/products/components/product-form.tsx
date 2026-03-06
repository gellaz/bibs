import { CreateProductBody } from "@bibs/api/schemas";
import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { Separator } from "@bibs/ui/components/separator";
import { Textarea } from "@bibs/ui/components/textarea";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { useCallback, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";

type ProductFormData = Static<typeof CreateProductBody>;
const compiledSchema = TypeCompiler.Compile(CreateProductBody);

import { CategoryPicker } from "./category-picker";
import {
	type ExistingImage,
	ProductImageDropzone,
} from "./product-image-dropzone";

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
}

interface ProductFormProps {
	defaultValues?: ProductFormDefaultValues;
	categories: { id: string; name: string }[];
	existingImages?: ExistingImage[];
	onDeleteExisting?: (imageId: string) => void;
	onSubmit: (values: ProductFormValues) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
}

export function ProductForm({
	defaultValues,
	categories,
	existingImages = [],
	onDeleteExisting,
	onSubmit,
	onCancel,
	isPending,
	submitLabel,
	pendingLabel,
}: ProductFormProps) {
	const {
		register,
		handleSubmit,
		setValue,
		watch,
		formState: { errors },
	} = useForm<ProductFormData>({
		resolver: typeboxResolver(compiledSchema),
		defaultValues: {
			name: defaultValues?.name ?? "",
			description: defaultValues?.description ?? "",
			price: defaultValues?.price ?? "",
			categoryIds: defaultValues?.categoryIds ?? [],
		},
	});

	const selectedCategories = watch("categoryIds");

	// Files and imageOrder are outside RHF (non-serializable File objects)
	const [files, setFiles] = useState<File[]>([]);
	const [imageOrder, setImageOrder] = useState<string[] | undefined>();

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

	const onFormSubmit: SubmitHandler<ProductFormData> = (data) => {
		// Normalize price to 2 decimal places (was previously a Zod .transform())
		const price = data.price.includes(".")
			? data.price
					.replace(/^(\d+\.\d{0,2}).*$/, "$1")
					.padEnd(data.price.indexOf(".") + 3, "0")
			: `${data.price}.00`;
		onSubmit({
			...data,
			price,
			files,
			imageOrder,
		});
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)} className="space-y-5">
			<div className="grid gap-4 sm:grid-cols-2">
				<Field data-invalid={!!errors.name} className="sm:col-span-2">
					<FieldLabel htmlFor="product-name" required>
						Nome
					</FieldLabel>
					<Input
						id="product-name"
						placeholder={defaultValues ? undefined : "Es. Pizza Margherita"}
						autoFocus={!defaultValues}
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>

				<Field className="sm:col-span-2">
					<FieldLabel htmlFor="product-description">Descrizione</FieldLabel>
					<Textarea
						id="product-description"
						placeholder={
							defaultValues ? undefined : "Descrizione del prodotto (opzionale)"
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
						placeholder={defaultValues ? undefined : "9.99"}
						{...register("price")}
					/>
					<FieldError errors={[errors.price]} />
				</Field>
			</div>

			<Separator />

			<Field data-invalid={!!errors.categoryIds}>
				<CategoryPicker
					categories={categories}
					selected={selectedCategories}
					onToggle={toggleCategory}
					required
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
