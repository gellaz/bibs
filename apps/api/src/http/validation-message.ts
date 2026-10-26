import { z } from "zod";
import { type Issue, issueRule, ruleParams } from "@/schemas/issues";
import { nodeAt } from "@/schemas/mirror";
import type { ValidationRule } from "./validation-rule";

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
export const INVALID = "valore non valido";

function items(n: number): string {
	return n === 1 ? "1 elemento" : `${n} elementi`;
}

/**
 * La regola violata, in italiano, senza il nome del campo. La usa
 * `zodValidationMessage`, più sotto, sulle issue di Zod.
 */
export function ruleText(rule: ValidationRule): string {
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
export function fieldLabel(path: string): string {
	const segments = path.split("/").slice(1);
	const last = segments.at(-1) ?? "";
	const label = FIELD_LABELS[last];
	if (!label) return segments.join(".");
	const index = segments.at(-2);
	return index !== undefined && /^\d+$/.test(index)
		? `${label} (riga ${Number(index) + 1})`
		: label;
}

/** 422 per un file il cui contenuto non corrisponde al tipo ammesso. */
export function invalidFileTypeMessage(property: string): string {
	// `property` è `body.file`: l'etichetta viene dall'ultimo segmento.
	return `${fieldLabel(`/${property.replaceAll(".", "/")}`)}: tipo di file non ammesso`;
}

// Il messaggio italiano del 422 per un'issue di Zod, con le stesse regole di
// sopra (ex `lib/validation-message.ts`) usate prima (D6 del piano Hono):
// `error` dello schema, poi «Richiesta non valida» per la radice, poi
// «Etichetta: regola» (etichetta da `title`, dal dizionario o dal path).

type Def = z.core.$ZodTypeDef & Record<string, any>;
const defOf = (schema: z.ZodType) => schema._zod.def as Def;

// Optional e default sono lo stesso campo, come prima: i loro metadati valgono.
function sameNode(schema: z.ZodType): z.ZodType[] {
	const chain = [schema];
	for (let s = schema; ; ) {
		const def = defOf(s);
		if (def.type !== "optional" && def.type !== "default") return chain;
		s = def.innerType;
		chain.push(s);
	}
}

/** `title` ed `error` dello schema che ha prodotto l'issue. */
export function issueMeta(root: z.ZodType, path: PropertyKey[]) {
	const node = nodeAt(root, path);
	const meta: { title?: unknown; error?: unknown } = {};
	for (const s of node ? sameNode(node) : []) {
		const m = z.globalRegistry.get(s);
		meta.title ??= m?.title;
		meta.error ??= m?.error;
	}
	return meta;
}

export function zodValidationMessage(issue: Issue, root: z.ZodType): string {
	const meta = issueMeta(root, issue.path);
	if (typeof meta.error === "string") return meta.error;
	const rule = ruleText(issueRule(issue, nodeAt(root, issue.path)));
	// Errore della decodifica (coercizione, t.Integer, t.Date): il
	// nome del campo è perso, resta la regola.
	if (ruleParams(issue)?.decode)
		return rule === INVALID
			? "Valore non valido"
			: `Valore non valido: ${rule}`;
	if (issue.path.length === 0) return "Richiesta non valida";
	const label =
		typeof meta.title === "string"
			? meta.title
			: fieldLabel(`/${issue.path.join("/")}`);
	return `${label}: ${rule}`;
}
