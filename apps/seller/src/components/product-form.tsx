import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { Separator } from "@bibs/ui/components/separator";
import { Textarea } from "@bibs/ui/components/textarea";
import { useCallback, useState } from "react";
import { CategoryPicker } from "@/components/category-picker";
import {
	type ExistingImage,
	ProductImageDropzone,
} from "@/components/product-image-dropzone";

export type { ExistingImage };

export interface ProductFormValues {
	name: string;
	description?: string;
	price: string;
	categoryIds: string[];
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
	const [selectedCategories, setSelectedCategories] = useState<string[]>(
		defaultValues?.categoryIds ?? [],
	);
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
		setSelectedCategories((prev) =>
			prev.includes(categoryId)
				? prev.filter((id) => id !== categoryId)
				: [...prev, categoryId],
		);
	};

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const fd = new FormData(e.currentTarget);
		const name = (fd.get("name") as string).trim();
		const description = (fd.get("description") as string).trim() || undefined;
		const priceRaw = (fd.get("price") as string).trim();

		if (!name || !priceRaw || selectedCategories.length === 0) return;

		const price = priceRaw.includes(".")
			? priceRaw
					.replace(/^(\d+\.\d{0,2}).*$/, "$1")
					.padEnd(priceRaw.indexOf(".") + 3, "0")
			: `${priceRaw}.00`;

		onSubmit({
			name,
			description,
			price,
			categoryIds: selectedCategories,
			files,
			imageOrder,
		});
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-5">
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-1.5 sm:col-span-2">
					<Label htmlFor="product-name">Nome *</Label>
					<Input
						id="product-name"
						name="name"
						defaultValue={defaultValues?.name}
						placeholder={defaultValues ? undefined : "Es. Pizza Margherita"}
						required
						autoFocus={!defaultValues}
					/>
				</div>

				<div className="space-y-1.5 sm:col-span-2">
					<Label htmlFor="product-description">Descrizione</Label>
					<Textarea
						id="product-description"
						name="description"
						defaultValue={defaultValues?.description ?? ""}
						placeholder={
							defaultValues ? undefined : "Descrizione del prodotto (opzionale)"
						}
						rows={2}
					/>
				</div>

				<div className="space-y-1.5">
					<Label htmlFor="product-price">Prezzo (€) *</Label>
					<Input
						id="product-price"
						name="price"
						type="number"
						step="0.01"
						min="0.01"
						defaultValue={defaultValues?.price}
						placeholder={defaultValues ? undefined : "9.99"}
						required
					/>
				</div>
			</div>

			<Separator />

			<CategoryPicker
				categories={categories}
				selected={selectedCategories}
				onToggle={toggleCategory}
				required
			/>

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
				<Button
					type="submit"
					disabled={isPending || selectedCategories.length === 0}
				>
					{isPending ? pendingLabel : submitLabel}
				</Button>
			</div>
		</form>
	);
}
