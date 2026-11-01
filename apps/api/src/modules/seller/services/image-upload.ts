import { db } from "@/db";
import { publicUrl, s3 } from "@/infra/s3";
import { ServiceError } from "@/lib/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Le query sulla tabella delle foto di un prodotto o di un negozio. */
interface ImageTarget<Row> {
	/** Cartella S3 delle foto, es. `products/<id>`. */
	folder: string;
	max: number;
	/** «prodotto» o «negozio», nel messaggio del tetto. */
	noun: string;
	count: (executor: typeof db | Tx) => Promise<number>;
	/** Blocca la riga del prodotto o del negozio fino alla fine della tx. */
	lock: (tx: Tx) => Promise<unknown>;
	insert: (
		tx: Tx,
		rows: { key: string; url: string; position: number }[],
	) => Promise<Row[]>;
}

/** Caricamento delle foto di prodotto e di negozio: S3 prima, poi le righe. */
export async function uploadImages<Row>(
	target: ImageTarget<Row>,
	files: File[],
	position?: number,
): Promise<Row[]> {
	const tooMany = (current: number) =>
		new ServiceError(
			400,
			`Massimo ${target.max} immagini per ${target.noun} (attuali: ${current}, in caricamento: ${files.length})`,
		);

	// Pre-check before touching S3; the authoritative check runs again under a
	// lock in the insert transaction.
	const current = await target.count(db);
	if (current + files.length > target.max) throw tooMany(current);

	// 1. Upload all files to S3 first
	const uploaded: { key: string; url: string; index: number }[] = [];
	try {
		await Promise.all(
			files.map(async (file, index) => {
				const ext = file.name?.split(".").pop() ?? "jpg";
				const key = `${target.folder}/${crypto.randomUUID()}.${ext}`;
				await s3.write(key, file);
				uploaded.push({ key, url: publicUrl(key), index });
			}),
		);
	} catch (err) {
		// Cleanup any files that were already uploaded
		await Promise.allSettled(uploaded.map((u) => s3.delete(u.key)));
		throw err;
	}

	// 2. Count and insert under a lock on the product or store: two concurrent
	// uploads both passing the pre-check would otherwise overshoot the cap.
	try {
		return await db.transaction(async (tx) => {
			await target.lock(tx);
			const locked = await target.count(tx);
			if (locked + files.length > target.max) throw tooMany(locked);

			return target.insert(
				tx,
				uploaded.map(({ key, url, index }) => ({
					key,
					url,
					position: position ?? locked + index,
				})),
			);
		});
	} catch (err) {
		// Cap exceeded or insert failed — cleanup S3 files (best-effort)
		await Promise.allSettled(uploaded.map((u) => s3.delete(u.key)));
		throw err;
	}
}
