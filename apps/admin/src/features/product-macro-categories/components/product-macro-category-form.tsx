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
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import {
	type ProductMacroCategoryFormData,
	productMacroCategoryFormSchema,
} from "@/features/product-macro-categories/schemas/product-macro-category";

interface ProductMacroCategoryFormProps {
	defaultValues?: ProductMacroCategoryFormData;
	onSubmit: (data: ProductMacroCategoryFormData) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
}

export function ProductMacroCategoryForm({
	defaultValues,
	onSubmit,
	onCancel,
	isPending,
	submitLabel,
	pendingLabel,
}: ProductMacroCategoryFormProps) {
	const {
		register,
		handleSubmit,
		control,
		reset,
		formState: { errors },
	} = useForm<ProductMacroCategoryFormData>({
		resolver: zodResolver(productMacroCategoryFormSchema),
		defaultValues: defaultValues ?? { name: "", suggestedVatRate: "22" },
	});

	useEffect(() => {
		if (defaultValues) {
			reset(defaultValues);
		}
	}, [defaultValues, reset]);

	const onFormSubmit: SubmitHandler<ProductMacroCategoryFormData> = (data) => {
		onSubmit(data);
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)}>
			<div className="space-y-4 py-4">
				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="product-macro-category-name">Nome</FieldLabel>
					<Input
						id="product-macro-category-name"
						placeholder="Es. Elettronica"
						autoFocus
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>

				<Field>
					<FieldLabel htmlFor="product-macro-category-vat">
						Aliquota IVA suggerita
					</FieldLabel>
					<Controller
						control={control}
						name="suggestedVatRate"
						render={({ field }) => (
							<Select value={field.value} onValueChange={field.onChange}>
								<SelectTrigger
									id="product-macro-category-vat"
									className="w-full"
								>
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
					<p className="text-muted-foreground text-xs">
						Pre-compila l'aliquota dei nuovi prodotti di questa macro. Il
						venditore può sempre modificarla.
					</p>
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
