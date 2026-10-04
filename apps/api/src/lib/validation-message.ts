import { Kind, type TSchema } from "@sinclair/typebox";
import { type ValueError, ValueErrorType } from "@sinclair/typebox/errors";
import { Value } from "@sinclair/typebox/value";
import type { ValidationError } from "elysia";

// Etichette italiane per i campi di input che arrivano dai form, sull'ultimo
// segmento del path. I campi assenti restano col path tecnico: utile al debug
// e raro per l'utente, perché i form validano già prima di inviare.
const FIELD_LABELS: Record<string, string> = {
	name: "Nome",
	firstName: "Nome",
	lastName: "Cognome",
	recipientName: "Destinatario",
	businessName: "Ragione sociale",
	legalForm: "Forma giuridica",
	email: "Email",
	password: "Password",
	confirmPassword: "Conferma password",
	phone: "Telefono",
	vatNumber: "Partita IVA",
	birthDate: "Data di nascita",
	birthCountry: "Paese di nascita",
	citizenship: "Cittadinanza",
	documentNumber: "Numero del documento",
	documentExpiry: "Scadenza del documento",
	residenceAddress: "Indirizzo di residenza",
	residenceZipCode: "CAP di residenza",
	address: "Indirizzo",
	street: "Via",
	number: "Numero civico",
	zipCode: "CAP",
	municipalityId: "Comune",
	country: "Paese",
	description: "Descrizione",
	websiteUrl: "Sito web",
	price: "Prezzo",
	listPrice: "Prezzo di listino",
	vatRate: "Aliquota IVA",
	ean: "EAN",
	brand: "Marca",
	brandName: "Marca",
	stock: "Scorta",
	delta: "Variazione di scorta",
	lowStockThreshold: "Soglia di scorta bassa",
	quantity: "Quantità",
	pointsToSpend: "Punti da usare",
	percent: "Percentuale",
	discountPercent: "Percentuale di sconto",
	startsAt: "Inizio",
	endsAt: "Fine",
	startDate: "Data di inizio",
	endDate: "Data di fine",
	date: "Data",
	oneOffDate: "Data",
	opensAt: "Apertura",
	closesAt: "Chiusura",
	open: "Apertura",
	close: "Chiusura",
	title: "Titolo",
	label: "Etichetta",
	note: "Note",
	reason: "Motivo",
	rejectionReason: "Motivo del rifiuto",
	search: "Ricerca",
	page: "Pagina",
	limit: "Elementi per pagina",
	radius: "Raggio",
	lat: "Latitudine",
	lng: "Longitudine",
	storeId: "Negozio",
	storeIds: "Negozi",
	productId: "Prodotto",
	productIds: "Prodotti",
	productCategoryId: "Categoria",
	categoryId: "Categoria",
	macroCategoryId: "Macro-categoria",
	shippingAddressId: "Indirizzo",
	type: "Tipo",
	status: "Stato",
	isActive: "Attivo",
	position: "Posizione",
	value: "Valore",
	file: "File",
	files: "File",
	image: "Immagine",
	documentImage: "Immagine del documento",
};

const FORMAT_RULES: Record<string, string> = {
	email: "indirizzo email non valido",
	uuid: "identificativo non valido",
	"calendar-date": "data non valida (AAAA-MM-GG)",
	uri: "indirizzo web non valido",
	"date-time": "data e ora non valide",
};

const REQUIRED = "campo obbligatorio";
const INVALID = "valore non valido";

function items(n: number): string {
	return n === 1 ? "1 elemento" : `${n} elementi`;
}

/** La regola violata, in italiano, senza il nome del campo. */
function describeRule(error: ValueError): string {
	const { schema, value } = error;
	if (value === undefined) return REQUIRED;

	switch (error.type) {
		case ValueErrorType.Union:
			return describeUnion(schema, value);
		case ValueErrorType.Kind:
			return schema[Kind] === "File" || schema[Kind] === "Files"
				? "tipo di file non ammesso"
				: INVALID;
		case ValueErrorType.Literal:
			return "valore non ammesso";
		case ValueErrorType.String:
			return "deve essere un testo";
		case ValueErrorType.Number:
			return "deve essere un numero";
		case ValueErrorType.Integer:
			return "deve essere un numero intero";
		case ValueErrorType.Boolean:
			return "deve essere vero o falso";
		case ValueErrorType.Array:
			return "deve essere un elenco";
		case ValueErrorType.StringMinLength:
			// normalize toglie gli spazi prima della validazione: minLength 1 = vuoto.
			return schema.minLength <= 1
				? REQUIRED
				: `almeno ${schema.minLength} caratteri`;
		case ValueErrorType.StringMaxLength:
			return `al massimo ${schema.maxLength} caratteri`;
		case ValueErrorType.StringPattern:
			return "formato non valido";
		case ValueErrorType.StringFormat:
		case ValueErrorType.StringFormatUnknown:
			return FORMAT_RULES[schema.format] ?? "formato non valido";
		case ValueErrorType.IntegerMinimum:
		case ValueErrorType.NumberMinimum:
			return `deve essere almeno ${schema.minimum}`;
		case ValueErrorType.IntegerMaximum:
		case ValueErrorType.NumberMaximum:
			return `deve essere al massimo ${schema.maximum}`;
		case ValueErrorType.IntegerExclusiveMinimum:
		case ValueErrorType.NumberExclusiveMinimum:
			return `deve essere maggiore di ${schema.exclusiveMinimum}`;
		case ValueErrorType.IntegerExclusiveMaximum:
		case ValueErrorType.NumberExclusiveMaximum:
			return `deve essere minore di ${schema.exclusiveMaximum}`;
		case ValueErrorType.ArrayMinItems:
			return `almeno ${items(schema.minItems)}`;
		case ValueErrorType.ArrayMaxItems:
			return `al massimo ${items(schema.maxItems)}`;
		case ValueErrorType.ArrayUniqueItems:
			return "elementi duplicati";
		default:
			return INVALID;
	}
}

// t.Integer, t.Nullable e t.Date sono Union: TypeBox dice solo «Expected union
// value». Si scartano il ramo null e quello di coercizione da stringa e si
// rivalida il valore sul ramo che resta, per avere la regola vera.
function describeUnion(schema: TSchema, value: unknown): string {
	const anyOf: TSchema[] = schema.anyOf ?? [];
	if (anyOf.length > 0 && anyOf.every((branch) => "const" in branch)) {
		return "valore non ammesso";
	}
	if (anyOf.some((branch) => branch.type === "Date")) {
		return "data non valida";
	}
	const branches = anyOf.filter(
		(branch) =>
			branch.type !== "null" &&
			!(branch.type === "string" && branch.format === "integer"),
	);
	const only = branches.length === 1 ? branches[0] : undefined;
	const inner = only && Value.Errors(only, value).First();
	return inner ? describeRule(inner) : INVALID;
}

/** «Quantità (riga 2)» per `/items/1/quantity`, path tecnico se non in dizionario. */
function fieldLabel(path: string): string {
	const segments = path.split("/").slice(1);
	const last = segments.at(-1) ?? "";
	const label = FIELD_LABELS[last];
	if (!label) return segments.join(".");
	const index = segments.at(-2);
	return index !== undefined && /^\d+$/.test(index)
		? `${label} (riga ${Number(index) + 1})`
		: label;
}

/**
 * Messaggio italiano per un 422 di validazione, sul primo errore: un toast ne
 * mostra uno solo. L'`error:` scritto sullo schema vince; altrimenti
 * «Etichetta: regola».
 */
export function validationMessage(
	error: Pick<ValidationError, "customError" | "valueError" | "type">,
): string {
	if (typeof error.customError === "string") return error.customError;

	const valueError = error.valueError;
	if (!valueError) return "Richiesta non valida";

	const rule = describeRule(valueError);
	if (valueError.path === "") {
		// Errori dei Decode di Elysia (coercizione in query, t.Date): il nome del
		// campo è perso, resta la regola.
		if (error.type === "property") {
			return rule === INVALID
				? "Valore non valido"
				: `Valore non valido: ${rule}`;
		}
		return "Richiesta non valida";
	}
	return `${fieldLabel(valueError.path)}: ${rule}`;
}

/** 422 di Elysia per un file il cui contenuto non corrisponde al tipo ammesso. */
export function invalidFileTypeMessage(property: string): string {
	// Elysia lo dà come `body.file`: l'etichetta viene dall'ultimo segmento.
	return `${fieldLabel(`/${property.replaceAll(".", "/")}`)}: tipo di file non ammesso`;
}
