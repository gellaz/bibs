import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { type SubmitHandler, useForm } from "react-hook-form";
import {
	type StoreMacroCategoryFormData,
	storeMacroCategoryFormSchema,
} from "@/features/store-macro-categories/schemas/store-macro-category";
import { zodResolver } from "@/lib/zod-resolver";
import { m } from "@/paraglide/messages";

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
	// Niente `reset(defaultValues)` in un effetto: il pannello passa un oggetto
	// nuovo a ogni render e il reset riscriveva i campi prima del submit (si
	// salvava il nome vecchio). Il dialog monta un form per riga (`key`).
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<StoreMacroCategoryFormData>({
		resolver: zodResolver(storeMacroCategoryFormSchema),
		defaultValues: defaultValues ?? { name: "" },
	});

	const onFormSubmit: SubmitHandler<StoreMacroCategoryFormData> = (data) => {
		onSubmit(data);
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)}>
			<div className="space-y-4 py-4">
				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="store-macro-category-name">
						{m.common_name()}
					</FieldLabel>
					<Input
						id="store-macro-category-name"
						placeholder={m.categories_store_macro_name_placeholder()}
						autoFocus
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>
			</div>

			<div className="flex justify-end gap-3">
				<Button type="button" variant="outline" onClick={onCancel}>
					{m.common_cancel()}
				</Button>
				<Button type="submit" disabled={isPending}>
					{isPending ? pendingLabel : submitLabel}
				</Button>
			</div>
		</form>
	);
}
