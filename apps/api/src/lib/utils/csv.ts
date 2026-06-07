import { ServiceError } from "@/lib/errors";

/**
 * Parser CSV minimale ma corretto rispetto ai campi quotati multi-riga
 * (RFC 4180): le virgolette possono contenere newline, virgole e `""` escapate.
 * Comportamenti preservati dai consumer (product-import, category-import):
 * header lowercased, campi trimmati, righe vuote saltate, input vuoto → 400.
 */
export function parseCsv(text: string): {
	headers: string[];
	rows: string[][];
} {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	const records: string[][] = [];
	let fields: string[] = [];
	let current = "";
	let inQuotes = false;
	// True se il record corrente ha contenuto "reale" (virgolette, virgole o
	// caratteri non-whitespace): replica il vecchio filtro delle righe bianche
	// SENZA scartare il caso `"   "` (campo quotato di soli spazi, che i
	// consumer segnalano come errore di riga).
	let recordHasContent = false;

	const endField = () => {
		fields.push(current.trim());
		current = "";
	};
	const endRecord = () => {
		endField();
		if (recordHasContent) records.push(fields);
		fields = [];
		recordHasContent = false;
	};

	for (let i = 0; i < normalized.length; i++) {
		const char = normalized[i];
		if (inQuotes) {
			if (char === '"') {
				if (normalized[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				// dentro le virgolette TUTTO è contenuto, newline inclusi
				current += char;
			}
		} else if (char === '"') {
			inQuotes = true;
			recordHasContent = true;
		} else if (char === ",") {
			endField();
			recordHasContent = true;
		} else if (char === "\n") {
			endRecord();
		} else {
			if (char !== " " && char !== "\t") recordHasContent = true;
			current += char;
		}
	}
	if (inQuotes) {
		throw new ServiceError(400, "Unterminated quoted field in CSV");
	}
	endRecord();

	if (records.length === 0) {
		throw new ServiceError(400, "CSV file is empty");
	}

	const headers = records[0].map((h) => h.toLowerCase());
	const rows = records.slice(1);
	return { headers, rows };
}
