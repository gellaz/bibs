import { z } from "zod";
import { m } from "@/paraglide/messages";
import { CHARACTERISTIC_DATA_TYPES } from "../data-type";

export const productCharacteristicFormSchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(1, { error: () => m.common_name_required() })
			.max(100),
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
				message: m.characteristics_unit_too_long(),
			});
		}

		if (data.dataType !== "enum") return;

		data.options.forEach((option, index) => {
			if (option.value.length > 100) {
				ctx.addIssue({
					code: "custom",
					path: ["options", index, "value"],
					message: m.characteristics_option_too_long(),
				});
			}
		});

		const values = data.options.map((o) => o.value).filter(Boolean);
		if (values.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["options"],
				message: m.characteristics_options_required(),
			});
		}
		const dup = values.find((v, i) => values.indexOf(v) !== i);
		if (dup) {
			ctx.addIssue({
				code: "custom",
				path: ["options"],
				message: m.characteristics_option_duplicate({ value: dup }),
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
