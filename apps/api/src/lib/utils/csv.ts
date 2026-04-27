import { ServiceError } from "@/lib/errors";

function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (inQuotes) {
			if (char === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += char;
			}
		} else if (char === '"') {
			inQuotes = true;
		} else if (char === ",") {
			fields.push(current.trim());
			current = "";
		} else {
			current += char;
		}
	}
	fields.push(current.trim());
	return fields;
}

export function parseCsv(text: string): {
	headers: string[];
	rows: string[][];
} {
	const lines = text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.split("\n")
		.filter((l) => l.trim() !== "");

	if (lines.length === 0) {
		throw new ServiceError(400, "CSV file is empty");
	}

	const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
	const rows = lines.slice(1).map(parseCsvLine);
	return { headers, rows };
}
