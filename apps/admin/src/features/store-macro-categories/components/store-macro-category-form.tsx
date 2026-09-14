import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import {
	type StoreMacroCategoryFormData,
	storeMacroCategoryFormSchema,
} from "@/features/store-macro-categories/schemas/store-macro-category";

interface StoreMacroCategoryFormProps {
	defaultValues?: StoreMacroCategoryFormData;
	onSubmit: (data: StoreMacroCategoryFormData) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
}

export function StoreMacroCategoryForm({
	defaultValues,
	onSubmit,
	onCancel,
	isPending,
	submitLabel,
	pendingLabel,
}: StoreMacroCategoryFormProps) {
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<StoreMacroCategoryFormData>({
		resolver: zodResolver(storeMacroCategoryFormSchema),
		defaultValues: defaultValues ?? { name: "" },
	});

	// Reset form when defaultValues change (e.g. switching between edit targets)
	useEffect(() => {
		if (defaultValues) {
			reset(defaultValues);
		}
	}, [defaultValues, reset]);

	const onFormSubmit: SubmitHandler<StoreMacroCategoryFormData> = (data) => {
		onSubmit(data);
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)}>
			<div className="space-y-4 py-4">
				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="store-macro-category-name">Nome</FieldLabel>
					<Input
						id="store-macro-category-name"
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
