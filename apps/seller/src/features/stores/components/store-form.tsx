import { CreateStoreBody } from "@bibs/api/schemas";
import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { Textarea } from "@bibs/ui/components/textarea";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { type SubmitHandler, useFieldArray, useForm } from "react-hook-form";

export type StoreFormData = Static<typeof CreateStoreBody>;
const compiledSchema = TypeCompiler.Compile(CreateStoreBody);

interface StoreFormProps {
	onSubmit: (data: StoreFormData) => void;
	onCancel: () => void;
	isPending: boolean;
}

export function StoreForm({ onSubmit, onCancel, isPending }: StoreFormProps) {
	const {
		register,
		handleSubmit,
		control,
		formState: { errors },
	} = useForm<StoreFormData>({
		resolver: typeboxResolver(compiledSchema),
		defaultValues: {
			name: "",
			description: "",
			addressLine1: "",
			addressLine2: "",
			city: "",
			zipCode: "",
			province: "",
			websiteUrl: "",
			phoneNumbers: [],
		},
	});

	const { fields, append, remove } = useFieldArray({
		control,
		name: "phoneNumbers",
	});

	const onFormSubmit: SubmitHandler<StoreFormData> = (data) => {
		// Clean up empty optional fields
		const cleaned: StoreFormData = {
			...data,
			description: data.description || undefined,
			addressLine2: data.addressLine2 || undefined,
			province: data.province || undefined,
			websiteUrl: data.websiteUrl || undefined,
			phoneNumbers:
				data.phoneNumbers && data.phoneNumbers.length > 0
					? data.phoneNumbers.map((p, idx) => ({
							label: p.label || undefined,
							number: p.number,
							position: idx,
						}))
					: undefined,
		};
		onSubmit(cleaned);
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)}>
			<div className="space-y-4 py-4">
				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="store-name" required>
						Nome
					</FieldLabel>
					<Input
						id="store-name"
						placeholder="Es. Bottega del Gusto"
						autoFocus
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>

				<Field>
					<FieldLabel htmlFor="store-description">Descrizione</FieldLabel>
					<Textarea
						id="store-description"
						placeholder="Descrizione del negozio (opzionale)"
						rows={2}
						{...register("description")}
					/>
				</Field>

				<Field data-invalid={!!errors.addressLine1}>
					<FieldLabel htmlFor="store-address1" required>
						Indirizzo
					</FieldLabel>
					<Input
						id="store-address1"
						placeholder="Via Roma 1"
						{...register("addressLine1")}
					/>
					<FieldError errors={[errors.addressLine1]} />
				</Field>

				<Field>
					<FieldLabel htmlFor="store-address2">Indirizzo (riga 2)</FieldLabel>
					<Input
						id="store-address2"
						placeholder="Interno, piano, scala (opzionale)"
						{...register("addressLine2")}
					/>
				</Field>

				<div className="grid grid-cols-2 gap-4">
					<Field data-invalid={!!errors.city}>
						<FieldLabel htmlFor="store-city" required>
							Città
						</FieldLabel>
						<Input id="store-city" placeholder="Milano" {...register("city")} />
						<FieldError errors={[errors.city]} />
					</Field>
					<Field data-invalid={!!errors.zipCode}>
						<FieldLabel htmlFor="store-zip" required>
							CAP
						</FieldLabel>
						<Input
							id="store-zip"
							placeholder="20100"
							{...register("zipCode")}
						/>
						<FieldError errors={[errors.zipCode]} />
					</Field>
				</div>

				<Field data-invalid={!!errors.province}>
					<FieldLabel htmlFor="store-province">Provincia</FieldLabel>
					<Input
						id="store-province"
						placeholder="MI (opzionale)"
						maxLength={2}
						{...register("province")}
					/>
					<FieldError errors={[errors.province]} />
				</Field>

				<Field data-invalid={!!errors.websiteUrl}>
					<FieldLabel htmlFor="store-website">Sito web</FieldLabel>
					<Input
						id="store-website"
						type="url"
						placeholder="https://esempio.it (opzionale)"
						{...register("websiteUrl")}
					/>
					<FieldError errors={[errors.websiteUrl]} />
				</Field>

				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<Label>Numeri di telefono</Label>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => append({ label: "", number: "" })}
						>
							<PlusIcon className="size-3" />
							<span>Aggiungi</span>
						</Button>
					</div>
					{fields.map((field, index) => (
						<div key={field.id} className="flex gap-2">
							<Input
								placeholder="Etichetta (es. Principale)"
								className="w-1/3"
								{...register(`phoneNumbers.${index}.label`)}
							/>
							<Field
								data-invalid={!!errors.phoneNumbers?.[index]?.number}
								className="flex-1"
							>
								<Input
									placeholder="Numero di telefono"
									type="tel"
									{...register(`phoneNumbers.${index}.number`)}
								/>
								<FieldError errors={[errors.phoneNumbers?.[index]?.number]} />
							</Field>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={() => remove(index)}
							>
								<Trash2Icon className="size-4" />
							</Button>
						</div>
					))}
				</div>
			</div>

			<div className="flex justify-end gap-3 pt-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					Annulla
				</Button>
				<Button type="submit" disabled={isPending}>
					{isPending ? "Creazione..." : "Crea Negozio"}
				</Button>
			</div>
		</form>
	);
}
