import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import {
	type StoreCategoryFormData,
	storeCategoryFormSchema,
} from "@/features/store-categories/schemas/store-category";

interface StoreCategoryFormProps {
	defaultValues?: StoreCategoryFormData;
	onSubmit: (data: StoreCategoryFormData) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
}

export function StoreCategoryForm({
	defaultValues,
	onSubmit,
	onCancel,
	isPending,
	submitLabel,
	pendingLabel,
}: StoreCategoryFormProps) {
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<StoreCategoryFormData>({
		resolver: zodResolver(storeCategoryFormSchema),
		defaultValues: defaultValues ?? { name: "" },
	});

	// Reset form when defaultValues change (e.g. switching between edit targets)
	useEffect(() => {
		if (defaultValues) {
			reset(defaultValues);
		}
	}, [defaultValues, reset]);

	const onFormSubmit: SubmitHandler<StoreCategoryFormData> = (data) => {
		onSubmit(data);
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)}>
			<div className="space-y-4 py-4">
				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="store-category-name">Nome</FieldLabel>
					<Input
						id="store-category-name"
						placeholder="Es. Alimentari"
						autoFocus
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>
			</div>

			<div className="flex justify-end gap-3">
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
