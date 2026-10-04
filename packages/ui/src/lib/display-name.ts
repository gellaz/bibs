/**
 * Nome da mostrare per un utente. Alla registrazione `name` è la parte locale
 * dell'email («mario.rossi»): finché l'utente non salva nome e cognome (che
 * riscrivono `name`) si mostra l'email intera, non un finto nome.
 */
export function displayName(user: {
	name?: string | null;
	email: string;
}): string {
	const name = user.name?.trim();
	const localPart = user.email.split("@")[0];
	return name && name !== localPart ? name : user.email;
}
