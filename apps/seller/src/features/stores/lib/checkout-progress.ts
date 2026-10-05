import { ApiError } from "@bibs/ui/lib/api-error";

/** Stato della Checkout come lo risponde `GET /seller/checkout-sessions/:id/status`. */
export type CheckoutStatus = "open" | "ready" | "expired" | "canceled";

/**
 * Cosa mostra la pagina di attesa dopo il pagamento:
 * - `waiting`: il webhook non è ancora arrivato, si interroga lo stato;
 * - `ready`: negozio creato, si va in home con quel negozio attivo;
 * - `timeout`: il webhook tarda, il pagamento però c'è;
 * - `failed`: nessun pagamento completato da aspettare (sessione assente,
 *   sconosciuta, scaduta o annullata), riaspettare non serve.
 */
export type CheckoutProgress =
	| { kind: "waiting" }
	| { kind: "ready"; storeId: string }
	| { kind: "timeout" }
	| { kind: "failed" };

export function checkoutProgress(input: {
	sessionId: string;
	status?: CheckoutStatus;
	storeId?: string;
	error?: unknown;
	timedOut: boolean;
}): CheckoutProgress {
	if (!input.sessionId) return { kind: "failed" };
	if (input.error instanceof ApiError && input.error.status === 404)
		return { kind: "failed" };
	if (input.status === "expired" || input.status === "canceled")
		return { kind: "failed" };
	// `ready` arriva con lo storeId (stessa transazione del webhook); senza, si
	// continua ad aspettare invece di andare in home senza negozio attivo.
	if (input.status === "ready" && input.storeId)
		return { kind: "ready", storeId: input.storeId };
	// Altri errori (rete, 5xx) sono transitori: si riprova fino al timeout.
	if (input.timedOut) return { kind: "timeout" };
	return { kind: "waiting" };
}

/**
 * Uscita dalla pagina di attesa a negozio creato. L'ordine conta: prima si
 * aspetta il refetch di ["stores"] (il FirstStoreGate sceglie il layout lì, e
 * con dati vecchi la home rimbalzerebbe su /store/new), poi si sceglie il
 * negozio attivo, che l'`ActiveStoreProvider` scarterebbe per il primo della
 * lista se non fosse ancora tra i negozi caricati.
 */
export async function finishCheckout(
	storeId: string,
	steps: {
		refetchStores: () => Promise<unknown>;
		setActiveStoreId: (storeId: string) => void;
		notify: () => void;
		goHome: () => unknown;
	},
): Promise<void> {
	await steps.refetchStores();
	steps.setActiveStoreId(storeId);
	steps.notify();
	await steps.goHome();
}
