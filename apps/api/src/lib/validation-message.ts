import type { ValueError } from "@sinclair/typebox/errors";
import type { ValidationError } from "elysia";
import { validationRule } from "./validation-rule";

// Etichette italiane per i campi di input che arrivano dai form, sull'ultimo
// segmento del path. I campi assenti restano col path tecnico: utile al debug
// e raro per l'utente, perché i form validano già prima di inviare. Un `title`
// sullo schema vince sul dizionario, per i nomi che cambiano senso tra route.
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
	const rule = validationRule(error);
	switch (rule.kind) {
		case "required":
			return REQUIRED;
		case "string":
			return "deve essere un testo";
		case "number":
			return "deve essere un numero";
		case "integer":
			return "deve essere un numero intero";
		case "boolean":
			return "deve essere vero o falso";
		case "array":
			return "deve essere un elenco";
		case "date":
			return "data non valida";
		case "notAllowed":
			return "valore non ammesso";
		case "fileType":
			return "tipo di file non ammesso";
		case "minLength":
			return `almeno ${rule.limit} caratteri`;
		case "maxLength":
			return `al massimo ${rule.limit} caratteri`;
		case "pattern":
			return "formato non valido";
		case "format":
			return FORMAT_RULES[rule.format] ?? "formato non valido";
		case "minimum":
			return `deve essere almeno ${rule.limit}`;
		case "maximum":
			return `deve essere al massimo ${rule.limit}`;
		case "exclusiveMinimum":
			return `deve essere maggiore di ${rule.limit}`;
		case "exclusiveMaximum":
			return `deve essere minore di ${rule.limit}`;
		case "minItems":
			return `almeno ${items(rule.limit)}`;
		case "maxItems":
			return `al massimo ${items(rule.limit)}`;
		case "uniqueItems":
			return "elementi duplicati";
		case "invalid":
			return INVALID;
	}
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
	const label = valueError.schema.title ?? fieldLabel(valueError.path);
	return `${label}: ${rule}`;
}

/** 422 di Elysia per un file il cui contenuto non corrisponde al tipo ammesso. */
export function invalidFileTypeMessage(property: string): string {
	// Elysia lo dà come `body.file`: l'etichetta viene dall'ultimo segmento.
	return `${fieldLabel(`/${property.replaceAll(".", "/")}`)}: tipo di file non ammesso`;
}
