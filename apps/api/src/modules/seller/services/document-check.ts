import { ServiceError } from "@/lib/errors";
import {
	DOCUMENT_NUMBER_EXAMPLES,
	type IdentityDocumentType,
	isDocumentExpired,
	isValidDocumentNumber,
	normalizeDocumentNumber,
	todayInRome,
} from "@/lib/schemas/forms/identity-document";

/**
 * Controlla numero (per tipo) e scadenza di un documento: 422 con il messaggio
 * per l'utente. Restituisce il numero normalizzato, quello da salvare.
 */
export function checkDocument(doc: {
	documentType: IdentityDocumentType;
	documentNumber: string;
	documentExpiry: string;
}): string {
	const documentNumber = normalizeDocumentNumber(doc.documentNumber);
	if (!isValidDocumentNumber(doc.documentType, documentNumber)) {
		throw new ServiceError(
			422,
			`Numero del documento non valido per il tipo scelto (es. ${DOCUMENT_NUMBER_EXAMPLES[doc.documentType]})`,
		);
	}
	if (isDocumentExpired(doc.documentExpiry, todayInRome())) {
		throw new ServiceError(422, "Il documento è scaduto");
	}
	return documentNumber;
}
