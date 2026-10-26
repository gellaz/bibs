import { db } from "@/db";

/**
 * Esegue `run` solo se nessun'altra connessione tiene l'advisory lock `lockKey`:
 * con più repliche dell'API un job gira su una sola alla volta. Il lock è di
 * sessione, quindi resta sulla stessa connessione del pool finché `run` non
 * finisce. Restituisce `false` se ha saltato il giro.
 *
 * Evita le sovrapposizioni, non le riesecuzioni: una replica il cui cron scatta
 * subito dopo la fine del giro di un'altra lo riesegue. Per questo ogni job
 * deve restare idempotente.
 */
export async function runExclusive(
	lockKey: number,
	run: () => Promise<void>,
): Promise<boolean> {
	const client = await db.$client.connect();
	try {
		const { rows } = await client.query<{ locked: boolean }>(
			"SELECT pg_try_advisory_lock($1) AS locked",
			[lockKey],
		);
		if (!rows[0]?.locked) return false;
		try {
			await run();
		} finally {
			await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
		}
		return true;
	} finally {
		client.release();
	}
}
