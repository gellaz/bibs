import { m } from "@/paraglide/messages";

export type PointTransactionType = "earned" | "redeemed" | "refunded";

/** Etichetta di un movimento: il participio al plurale, riferito ai punti. */
export const POINT_TYPE_LABEL: Record<PointTransactionType, () => string> = {
	earned: m.points_type_earned,
	redeemed: m.points_type_redeemed,
	refunded: m.points_type_refunded,
};

/**
 * Il segno viene dal tipo, non da `amount`: l'API scrive `redeemed` con
 * importo positivo (`createOrder` inserisce `actualPointsSpent`), nonostante la
 * descrizione dello schema dica «negativa per redeemed». Il valore assoluto
 * regge entrambe le convenzioni.
 */
export function signedPoints(tx: {
	type: PointTransactionType;
	amount: number;
}): number {
	const abs = Math.abs(tx.amount);
	return tx.type === "redeemed" ? -abs : abs;
}

/** «+12» / «−5» (segno meno tipografico); lo zero resta senza segno. */
export function formatSignedPoints(value: number): string {
	if (value === 0) return "0";
	return `${value > 0 ? "+" : "−"}${Math.abs(value)}`;
}

export interface PointRow {
	id: string;
	label: string;
	points: string;
	gain: boolean;
	orderId: string | null;
	/** Solo per i movimenti senza ordine: le descrizioni legate a un ordine
	 *  sono testo tecnico in inglese scritto dall'API, e l'ordine le spiega già. */
	note: string | null;
	createdAt: Date;
}

export function toPointRow(tx: {
	id: string;
	type: PointTransactionType;
	amount: number;
	orderId: string | null;
	description: string | null;
	createdAt: Date | string;
}): PointRow {
	const value = signedPoints(tx);
	return {
		id: tx.id,
		label: POINT_TYPE_LABEL[tx.type](),
		points: formatSignedPoints(value),
		gain: value >= 0,
		orderId: tx.orderId,
		note: tx.orderId ? null : tx.description?.trim() || null,
		createdAt: new Date(tx.createdAt),
	};
}
