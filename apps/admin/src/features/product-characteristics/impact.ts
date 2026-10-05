import { m } from "@/paraglide/messages";
import type {
	CharacteristicBaseline,
	ProductCharacteristicFormData,
} from "./schemas/product-characteristic";

/**
 * Quanti prodotti perdono un valore salvando `form`. Replica la regola del
 * server (updateProductCharacteristic): un cambio di tipo li tocca tutti,
 * altrimenti contano le sole opzioni salvate che il form non contiene più.
 * Il server ricalcola comunque e respinge con 409 una conferma troppo bassa.
 */
export function characteristicUpdateImpact(
	baseline: CharacteristicBaseline,
	form: ProductCharacteristicFormData,
): number {
	if (form.dataType !== baseline.dataType) return baseline.valueCount;
	if (form.dataType !== "enum") return 0;
	// Un'opzione conta come mantenuta solo con optionId E un valore non vuoto:
	// il server droppa le opzioni vuote (normalizeDefinition) prima di decidere
	// quali id restano, quindi un'opzione con id ma valore svuotato viene
	// comunque rimossa lato server.
	const kept = new Set(
		form.options
			.filter((o) => o.value.trim())
			.flatMap((o) => (o.optionId ? [o.optionId] : [])),
	);
	return baseline.options
		.filter((o) => !kept.has(o.id))
		.reduce((sum, o) => sum + o.valueCount, 0);
}

/** Il testo della conferma: cambio di tipo o opzioni rimosse in uso. */
export function confirmDescription(typeChanged: boolean, count: number) {
	if (typeChanged)
		return count === 1
			? m.characteristics_confirm_type_change_one({ count })
			: m.characteristics_confirm_type_change({ count });
	return count === 1
		? m.characteristics_confirm_options_removed_one({ count })
		: m.characteristics_confirm_options_removed({ count });
}
