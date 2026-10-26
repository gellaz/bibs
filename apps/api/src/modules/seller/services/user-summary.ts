/**
 * Utente visto da un altro ruolo non admin (cliente al seller, dipendente al
 * titolare): le stesse colonne di `UserSummarySchema`, selezionate già nella
 * query così role/ban* e le date dell'account non escono dal DB.
 *
 * Da usare in un blocco `with:` sotto una relazione `user`, es.
 * `with: { user: userSummaryWith }`.
 */
export const userSummaryWith = {
	columns: { id: true, name: true, email: true, image: true },
} as const;
