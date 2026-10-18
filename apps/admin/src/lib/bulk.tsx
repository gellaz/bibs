import { toast } from "@bibs/ui/components/sonner";
import { m } from "@/paraglide/messages";

export interface BulkResult {
	ok: number;
	failed: { name: string; message: string }[];
}

// L'API non ha endpoint di massa: una chiamata per voce, ognuna con i suoi
// controlli (voce in uso, conferma dei valori). Chi fallisce non ferma le altre.
// ponytail: fino a 100 righe per pagina basta; un endpoint di massa serve solo
// se diventa necessario il tutto-o-niente.
export async function runBulk<T extends { name: string }>(
	items: T[],
	run: (item: T) => Promise<unknown>,
): Promise<BulkResult> {
	const results = await Promise.allSettled(items.map(run));
	const failed = results.flatMap((r, i) =>
		r.status === "rejected"
			? [
					{
						name: items[i].name,
						message:
							r.reason instanceof Error ? r.reason.message : String(r.reason),
					},
				]
			: [],
	);
	return { ok: items.length - failed.length, failed };
}

const SHOWN_FAILURES = 3;

export function toastBulkResult(
	{ ok, failed }: BulkResult,
	labels: { done: (count: number) => string; error: string },
) {
	if (failed.length === 0) {
		toast.success(labels.done(ok));
		return;
	}
	const description = (
		<ul>
			{failed.slice(0, SHOWN_FAILURES).map((f) => (
				<li key={f.name}>
					{f.name}: {f.message}
				</li>
			))}
			{failed.length > SHOWN_FAILURES && (
				<li>{m.common_bulk_more({ count: failed.length - SHOWN_FAILURES })}</li>
			)}
		</ul>
	);
	if (ok === 0) toast.error(labels.error, { description });
	else
		toast.warning(m.common_bulk_partial({ ok, total: ok + failed.length }), {
			description,
		});
}
