/**
 * Errore di una risposta API con il suo status HTTP, così chi lo riceve
 * (es. la policy di retry di TanStack Query) può distinguere un 4xx
 * definitivo da un 5xx o da un errore di rete.
 */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "ApiError";
	}
}
