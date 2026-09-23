import { z } from "zod";
import { CHARACTERISTIC_DATA_TYPES } from "../data-type";

export const productCharacteristicFormSchema = z
	.object({
		name: z.string().trim().min(1, "Il nome è obbligatorio").max(100),
		dataType: z.enum(CHARACTERISTIC_DATA_TYPES),
		// La lunghezza massima si valida in superRefine, solo quando il campo è
		// visibile: un `.max()` qui bloccherebbe il salvataggio in silenzio anche
		// quando il campo è nascosto per un altro dataType.
		unit: z.string().trim(),
		// `optionId`, non `id`: useFieldArray riserva `id` per le sue chiavi.
		options: z.array(
			z.object({
				optionId: z.string().optional(),
				value: z.string().trim(),
			}),
		),
	})
	.superRefine((data, ctx) => {
		if (data.dataType === "number" && data.unit.length > 20) {
			ctx.addIssue({
				code: "custom",
				path: ["unit"],
				message: "L'unità di misura non può superare 20 caratteri",
			});
		}

		if (data.dataType !== "enum") return;

		data.options.forEach((option, index) => {
			if (option.value.length > 100) {
				ctx.addIssue({
					code: "custom",
					path: ["options", index, "value"],
					message: "Il valore dell'opzione non può superare 100 caratteri",
				});
			}
		});

		const values = data.options.map((o) => o.value).filter(Boolean);
		if (values.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["options"],
				message: "Una lista chiusa richiede almeno un'opzione",
			});
		}
		const dup = values.find((v, i) => values.indexOf(v) !== i);
		if (dup) {
			ctx.addIssue({
				code: "custom",
				path: ["options"],
				message: `Opzione ripetuta: "${dup}"`,
			});
		}
	});

export type ProductCharacteristicFormData = z.infer<
	typeof productCharacteristicFormSchema
>;

/** Lo stato salvato, contro cui il form misura quanti prodotti perdono un valore. */
export interface CharacteristicBaseline {
	dataType: ProductCharacteristicFormData["dataType"];
	valueCount: number;
	options: { id: string; valueCount: number }[];
}

/** Quello che il form consegna al pannello: i dati, e il numero confermato. */
export interface ProductCharacteristicSubmit {
	form: ProductCharacteristicFormData;
	baseline?: CharacteristicBaseline;
	confirmAffected: number;
}
