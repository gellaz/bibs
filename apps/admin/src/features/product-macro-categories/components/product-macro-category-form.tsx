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
	// `defaultValues` initialises the form once on mount. The dialog that hosts
	// this form unmounts its content on close (Radix Dialog), so each open
	// re-mounts with fresh values — no `reset()` effect needed. A previous
	// `useEffect(() => reset(defaultValues), [defaultValues])` was harmful: the
	// parent passes a NEW `defaultValues` object every render, so the effect
	// re-ran and clobbered the controlled <Select> mid-interaction (its
	// onValueChange never stuck). Keep this form free of that effect; if the
	// hosting dialog ever switches to forceMount, key the form on the macro id
	// instead of reintroducing a reset effect.
	const {
		register,
		handleSubmit,
		control,
		formState: { errors },
	} = useForm<ProductMacroCategoryFormData>({
		resolver: zodResolver(productMacroCategoryFormSchema),
		defaultValues: defaultValues ?? { name: "", suggestedVatRate: "22" },
	});

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
