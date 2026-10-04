/**
 * Saluto d'apertura: col nome se l'utente l'ha dato (profilo), altrimenti
 * neutro. Mai il `user.name` di better-auth: alla registrazione è la parte
 * locale dell'email.
 */
export function greeting(firstName?: string | null): string {
	const name = firstName?.trim();
	return name ? `Ciao ${name},` : "Ciao,";
}
