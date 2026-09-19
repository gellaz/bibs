/**
 * Stato del form indirizzo, come funzioni pure. Nessun import: i tipi in
 * ingresso sono strutturali, così i tipi Eden delle query li soddisfano per
 * forma senza che questo file dipenda da loro.
 */

export interface MunicipalityOption {
	id: string;
	name: string;
	provinceAcronym: string;
}

/** La parte di un suggerimento del geocoder che riempie il form. */
export interface SuggestionLike {
	addressLine1: string;
	zipCode: string | null;
	location: { x: number; y: number };
	municipality: MunicipalityOption | null;
	municipalityCandidates: MunicipalityOption[];
}

/** La parte di un indirizzo salvato che riempie il form in modifica. */
export interface AddressLike {
	label: string | null;
	recipientName: string | null;
	phone: string | null;
	addressLine1: string;
	addressLine2: string | null;
	zipCode: string;
	municipality: MunicipalityOption;
	location: { x: number; y: number } | null;
	isDefault: boolean;
}

export interface AddressFormValues {
	label: string;
	recipientName: string;
	phone: string;
	addressLine1: string;
	addressLine2: string;
	zipCode: string;
	municipalityId: string | null;
	location: { x: number; y: number } | null;
	isDefault: boolean;
	/** Omonimi da far scegliere al cliente quando il geocoder non ha deciso. */
	municipalityCandidates: MunicipalityOption[];
}

/**
 * Codici, non testo: la copia vive in Paraglide, e questo modulo resta
 * testabile senza tirarsi dietro le traduzioni.
 */
export interface AddressFormErrors {
	addressLine1?: "required";
	zipCode?: "required" | "format";
	municipalityId?: "required";
	location?: "required";
}

const ZIP_PATTERN = /^\d{5}$/;

export function emptyAddressForm(): AddressFormValues {
	return {
		label: "",
		recipientName: "",
		phone: "",
		addressLine1: "",
		addressLine2: "",
		zipCode: "",
		municipalityId: null,
		location: null,
		isDefault: false,
		municipalityCandidates: [],
	};
}

/**
 * Applica un suggerimento ai soli campi dell'indirizzo, preservando quelli che
 * il cliente ha già compilato di suo (etichetta, destinatario, telefono,
 * predefinito).
 */
export function suggestionToAddressForm(
	suggestion: SuggestionLike,
	previous: AddressFormValues,
): AddressFormValues {
	return {
		...previous,
		addressLine1: suggestion.addressLine1,
		zipCode: suggestion.zipCode ?? "",
		municipalityId: suggestion.municipality?.id ?? null,
		municipalityCandidates: suggestion.municipalityCandidates,
		location: suggestion.location,
	};
}

export function addressToAddressForm(address: AddressLike): AddressFormValues {
	return {
		label: address.label ?? "",
		recipientName: address.recipientName ?? "",
		phone: address.phone ?? "",
		addressLine1: address.addressLine1,
		addressLine2: address.addressLine2 ?? "",
		zipCode: address.zipCode,
		municipalityId: address.municipality.id,
		location: address.location,
		isDefault: address.isDefault,
		municipalityCandidates: [],
	};
}

export function validateAddressForm(
	values: AddressFormValues,
): AddressFormErrors {
	const errors: AddressFormErrors = {};

	if (!values.addressLine1.trim()) errors.addressLine1 = "required";

	const zip = values.zipCode.trim();
	if (!zip) errors.zipCode = "required";
	else if (!ZIP_PATTERN.test(zip)) errors.zipCode = "format";

	if (!values.municipalityId) errors.municipalityId = "required";

	// Senza coordinate l'indirizzo non può essere origine di una ricerca, che è
	// metà del motivo per cui la rubrica esiste.
	if (!values.location) errors.location = "required";

	return errors;
}

export function isAddressFormValid(errors: AddressFormErrors): boolean {
	return Object.keys(errors).length === 0;
}

/**
 * Il body per `POST`/`PATCH /customer/addresses`. `phone` viene omesso quando è
 * vuoto perché l'API impone un minimo di 5 caratteri; etichetta e destinatario
 * vuoti vengono mandati, così cancellarli è possibile.
 */
export function addressFormToBody(values: AddressFormValues) {
	const phone = values.phone.trim();
	return {
		label: values.label.trim(),
		recipientName: values.recipientName.trim(),
		...(phone ? { phone } : {}),
		addressLine1: values.addressLine1.trim(),
		addressLine2: values.addressLine2.trim(),
		municipalityId: values.municipalityId as string,
		zipCode: values.zipCode.trim(),
		...(values.location ? { location: values.location } : {}),
		isDefault: values.isDefault,
	};
}
